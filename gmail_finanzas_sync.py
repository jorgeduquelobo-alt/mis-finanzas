import os
import io
import re
import json
import base64
import argparse
import datetime
from bs4 import BeautifulSoup
from pypdf import PdfReader

# Google API
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

# Gemini
from google import genai
from google.genai import types

# Firebase
from firebase_admin import firestore, messaging
from utils import conectar_db
from tx_enrich import (
    build_merchant_memory, memory_for_prompt, apply_merchant_memory,
    validate_classification, looks_like_statement,
)

# --- CONFIGURACIÓN ---
# Zona horaria de Colombia (UTC-5 fijo; el país no usa horario de verano).
# Offset fijo → no depende de tzdata del sistema, funciona igual en CI y local.
BOGOTA = datetime.timezone(datetime.timedelta(hours=-5))

# Permisos necesarios para leer labels y modificar (quitar) etiquetas
GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.modify']

# Etiqueta por defecto a buscar (se puede sobreescribir con gmailLabel en
# finance_settings/default — editable en la app en Settings → Finanzas — o con
# el flag --label, que tiene prioridad sobre ambos)
DEFAULT_LABEL = "Bancos/PendingBot"

# Fondo de Seguridad Financiera: al guardar un ingreso real (type 'credit')
# se aparta automáticamente este % hacia FONDO10_CUENTA como una
# Transferencia. Igual que gmailLabel, se puede sobreescribir con
# fondo10Cuenta / fondo10Porcentaje / fondo10Activo en finance_settings/default
# (editable en la app en Settings → Finanzas).
FONDO10_CUENTA = "Fondo de Seguridad Financiera"
FONDO10_PORCENTAJE = 10

# Modelo de Gemini
GEMINI_MODEL = "gemini-3.1-flash-lite"

# Documento de Firestore donde vive el token de OAuth de Gmail
TOKEN_COLLECTION = 'gmail_auth'
TOKEN_DOC = 'token'

# Colección de Firestore con los IDs de correos ya procesados
PROCESSED_COLLECTION = 'processed_gmail_ids'

# Tamaño máximo de texto del correo enviado al modelo
MAX_BODY_CHARS = 3500

# Cuántas transacciones recientes traer para construir la memoria de comercios
MEMORY_HISTORY_LIMIT = 400

# --- Extractos de deuda (tarjetas de crédito / créditos) ---
# Algunos bancos mandan el extracto mensual como un PDF CIFRADO con una clave
# personal (cédula/NIT del titular). Esos correos van a la misma etiqueta
# Bancos/PendingBot, pero NO son una transacción individual: los detectamos
# por remitente y los procesamos aparte (desencriptar → extraer texto →
# Gemini → guardar snapshot de la deuda). La contraseña vive SOLO en la
# variable de entorno EXTRACTO_PDF_PASSWORD (secret de GitHub Actions) —
# nunca se guarda en este archivo ni en Firestore.
#
# Mapea el correo remitente al nombre de la entidad/deuda. Agregar aquí
# nuevos bancos (ej. Finandina) cuando se confirme el remitente real.
# OJO: los extractos de Fiducuenta/Consolidado de Bancolombia NO están acá
# a propósito — son cuentas de inversión, no deuda.
EXTRACTO_DEBT_SENDERS = {
    'extracto@clientesbancoavvillas.com.co': 'AV Villas',
    'bancodavivienda@davivienda.com': 'Davivienda (TC Retail SU+)',
}

# Colección de Firestore donde vive el snapshot más reciente de cada deuda.
DEUDAS_COLLECTION = 'finance_deudas'


def _load_token(db):
    """Lee el token de OAuth de Gmail desde Firestore."""
    doc = db.collection(TOKEN_COLLECTION).document(TOKEN_DOC).get()
    return doc.to_dict() if doc.exists else None


def _save_token(db, token_info):
    """Guarda (o actualiza) el token de OAuth de Gmail en Firestore."""
    db.collection(TOKEN_COLLECTION).document(TOKEN_DOC).set(token_info)


def authenticate_gmail(db):
    """Autentica con la API de Gmail usando el token guardado en Firestore.

    El token (con su refresh_token, client_id y client_secret) se siembra una
    sola vez con bootstrap_token.py. Aquí solo se carga y, si está expirado, se
    refresca y se vuelve a guardar en Firestore. No hay flujo interactivo: este
    código corre sin navegador en GitHub Actions.
    """
    token_info = _load_token(db)
    if not token_info:
        raise RuntimeError(
            f"No hay token de Gmail en Firestore ({TOKEN_COLLECTION}/{TOKEN_DOC}). "
            "Ejecuta bootstrap_token.py una vez localmente para inicializarlo."
        )

    creds = Credentials.from_authorized_user_info(token_info, GMAIL_SCOPES)

    if not creds.valid:
        if creds.expired and creds.refresh_token:
            print("🔄 Token expirado. Refrescando...")
            creds.refresh(Request())
            _save_token(db, json.loads(creds.to_json()))
            print("✅ Token refrescado y guardado en Firestore.")
        else:
            raise RuntimeError(
                "El token de Gmail no es válido y no se puede refrescar. "
                "Genera un token.json nuevo localmente y vuelve a ejecutar "
                "bootstrap_token.py."
            )

    return build('gmail', 'v1', credentials=creds)


def is_processed(db, email_id):
    """Indica si un correo ya fue procesado anteriormente."""
    return db.collection(PROCESSED_COLLECTION).document(email_id).get().exists


def save_processed_email(db, email_id):
    """Registra un correo como procesado en Firestore."""
    db.collection(PROCESSED_COLLECTION).document(email_id).set({
        'processedAt': firestore.SERVER_TIMESTAMP
    })


def get_label_id(service, label_name):
    """Busca el ID interno de Gmail correspondiente al nombre de una etiqueta."""
    results = service.users().labels().list(userId='me').execute()
    labels = results.get('labels', [])
    for label in labels:
        if label['name'].lower() == label_name.lower():
            return label['id']
    return None


def extract_email_body(payload):
    """Extrae el texto del cuerpo del correo, limpiando HTML."""
    text_content = ""

    # Función recursiva para buscar la parte de texto
    def get_text_from_parts(parts):
        nonlocal text_content
        for part in parts:
            mime_type = part.get("mimeType")
            body = part.get("body", {})
            data = body.get("data")

            if mime_type == "text/plain" and data:
                text_content += base64.urlsafe_b64decode(data).decode("utf-8")
            elif mime_type == "text/html" and data:
                html = base64.urlsafe_b64decode(data).decode("utf-8")
                soup = BeautifulSoup(html, "html.parser")
                text_content += soup.get_text(separator="\n")
            elif "parts" in part:
                get_text_from_parts(part["parts"])

    if "parts" in payload:
        get_text_from_parts(payload["parts"])
    else:
        # El correo podría no ser multipart
        body = payload.get("body", {})
        data = body.get("data")
        mime_type = payload.get("mimeType", "")
        if data:
            decoded = base64.urlsafe_b64decode(data).decode("utf-8")
            if "html" in mime_type:
                soup = BeautifulSoup(decoded, "html.parser")
                text_content = soup.get_text(separator="\n")
            else:
                text_content = decoded

    return text_content.strip()


def _sender_email(payload):
    """Extrae la dirección de correo del header 'From' (en minúsculas)."""
    from_header = next((h.get('value', '') for h in payload.get('headers', [])
                        if h.get('name', '').lower() == 'from'), '')
    match = re.search(r'[\w.+-]+@[\w-]+\.[\w.-]+', from_header)
    return match.group(0).lower() if match else ''


def _find_pdf_attachment_id(payload):
    """Busca recursivamente el primer adjunto .pdf en el payload y devuelve
    su attachmentId (o None si no hay ninguno)."""
    def walk(parts):
        for part in parts:
            filename = (part.get('filename') or '')
            body = part.get('body', {})
            if filename.lower().endswith('.pdf') and body.get('attachmentId'):
                return body['attachmentId']
            if 'parts' in part:
                found = walk(part['parts'])
                if found:
                    return found
        return None
    return walk(payload.get('parts', [])) if 'parts' in payload else None


def _download_and_decrypt_pdf(service, msg_id, attachment_id, password):
    """Descarga el adjunto PDF desde Gmail y lo desencripta con la
    contraseña dada. Devuelve el texto plano extraído de todas las páginas."""
    att = service.users().messages().attachments().get(
        userId='me', messageId=msg_id, id=attachment_id
    ).execute()
    data = base64.urlsafe_b64decode(att['data'])

    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted:
        result = reader.decrypt(password)
        if not result:
            raise ValueError("Contraseña incorrecta o PDF no se pudo desencriptar.")

    texto = "\n".join(page.extract_text() or "" for page in reader.pages)
    return texto


def procesar_extracto_deuda_con_ia(texto, entidad, client):
    """Analiza el texto de un extracto de deuda con Gemini y devuelve el
    snapshot: saldoTotal, cupoTotal, pagoMinimo, pagoMinimoReducido,
    fechaFacturacion, fechaPago, moneda."""
    prompt = f"""Eres un experto asistente financiero. El siguiente es el texto extraído de un
extracto colombiano de tarjeta de crédito o producto de crédito (entidad: {entidad}).
Extrae ÚNICAMENTE estos campos y devuelve un objeto JSON:

- saldoTotal: saldo total adeudado (número, sin símbolos de moneda ni separadores de miles).
- cupoTotal: cupo/límite total del producto (número). Si no aparece, usa null.
- pagoMinimo: valor del pago mínimo exigido (número).
- pagoMinimoReducido: valor del pago mínimo reducido, si aparece (número o null).
- fechaFacturacion: fecha de facturación/corte del extracto, formato YYYY-MM-DD.
- fechaPago: fecha límite de pago ("pague hasta"), formato YYYY-MM-DD.
- moneda: 'COP' salvo que el extracto indique explícitamente otra.

Texto del extracto:
\"\"\"{texto[:6000]}\"\"\"

Devuelve solo el JSON, sin explicación ni markdown. Formato esperado:
{{"saldoTotal": 0, "cupoTotal": 0, "pagoMinimo": 0, "pagoMinimoReducido": 0, "fechaFacturacion": "", "fechaPago": "", "moneda": "COP"}}
"""
    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction="Eres un asistente financiero. Respondes únicamente con un objeto JSON válido.",
            response_mime_type="application/json",
            temperature=0,
        ),
    )
    return json.loads(response.text)


def _slug(texto):
    return re.sub(r'[^a-z0-9]+', '-', texto.lower()).strip('-')


def registrar_deuda(db, entidad, datos):
    """Guarda (reemplaza) el snapshot más reciente de una deuda en Firestore."""
    def _num(v):
        return float(v) if v is not None else None

    doc_id = _slug(entidad)
    db.collection(DEUDAS_COLLECTION).document(doc_id).set({
        'entidad': entidad,
        'saldoTotal': _num(datos.get('saldoTotal')) or 0,
        'cupoTotal': _num(datos.get('cupoTotal')),
        'pagoMinimo': _num(datos.get('pagoMinimo')) or 0,
        'pagoMinimoReducido': _num(datos.get('pagoMinimoReducido')),
        'fechaFacturacion': datos.get('fechaFacturacion') or None,
        'fechaPago': datos.get('fechaPago') or None,
        'moneda': datos.get('moneda') or 'COP',
        'updatedAt': firestore.SERVER_TIMESTAMP,
    })


def procesar_correo_extracto_deuda(db, service, client, msg_id, payload, entidad):
    """Pipeline completo para un correo de extracto de deuda cifrado:
    descarga el PDF, lo desencripta, extrae los datos con Gemini y los guarda
    en Firestore. Devuelve True si quedó guardado (correo listo para
    marcarse como procesado), False si hay que reintentar más tarde."""
    password = os.environ.get('EXTRACTO_PDF_PASSWORD')
    if not password:
        print("❌ Falta la variable de entorno EXTRACTO_PDF_PASSWORD. No se puede desencriptar el extracto.")
        return False

    attachment_id = _find_pdf_attachment_id(payload)
    if not attachment_id:
        print(f"⚠️ No se encontró un adjunto PDF en el correo de extracto de {entidad}.")
        return False

    try:
        texto = _download_and_decrypt_pdf(service, msg_id, attachment_id, password)
    except Exception as e:
        print(f"❌ Error desencriptando/leyendo el PDF de {entidad}: {e}")
        return False

    if not texto.strip():
        print(f"⚠️ El PDF de {entidad} se desencriptó pero no se pudo extraer texto legible.")
        return False

    try:
        datos = procesar_extracto_deuda_con_ia(texto, entidad, client)
    except Exception as e:
        print(f"❌ Error analizando el extracto de {entidad} con Gemini: {e}")
        return False

    try:
        registrar_deuda(db, entidad, datos)
        print(f"✅ Deuda de {entidad} actualizada: saldo {datos.get('saldoTotal')}, vence {datos.get('fechaPago')}")
        return True
    except Exception as e:
        print(f"❌ Error guardando la deuda de {entidad} en Firestore: {e}")
        return False


def _prefetch_context(db):
    """Trae desde Firestore el contexto necesario para el análisis:
    árbol de categorías (con subcategorías), cuentas, monedas y las últimas
    transacciones registradas (para inferir contexto y normalizar subcategoría).
    """
    doc = db.collection('finance_settings').document('default').get()
    categorias_raw, cuentas, monedas = [], [], []
    if doc.exists:
        data = doc.to_dict()
        categorias_raw = data.get('categories', [])
        cuentas = data.get('accounts', [])
        monedas = data.get('currencies', [])

    # Normalizar categorías a {name, subcategories}
    cat_tree = []
    for c in categorias_raw:
        if isinstance(c, dict):
            cat_tree.append({
                'name': c.get('name'),
                'subcategories': c.get('subcategories', []),
            })
        else:
            cat_tree.append({'name': c, 'subcategories': []})

    # Historial para la memoria de comercios (ventana amplia: cubre comercios
    # antiguos que no entran en "las últimas 20"). De aquí salen también las
    # recientes que se muestran como muestra en el prompt.
    historial = []
    try:
        docs = db.collection('finance_transactions') \
            .order_by('date', direction=firestore.Query.DESCENDING) \
            .limit(MEMORY_HISTORY_LIMIT).get()
        for d in docs:
            tx = d.to_dict()
            historial.append({
                'title': tx.get('title'),
                'category': tx.get('category'),
                'subcategory': tx.get('subcategory', ''),
                'context': tx.get('context', 'personal'),
                'type': tx.get('type'),
            })
    except Exception as e:
        print(f"⚠️ No se pudo traer el historial: {e}")

    memoria = build_merchant_memory(historial)
    recientes = historial[:20]
    return cat_tree, cuentas, monedas, recientes, memoria


def procesar_texto_con_ia(texto, db, client):
    """Analiza el correo con Gemini y devuelve la transacción enriquecida.

    En una sola llamada extrae la transacción y la normaliza (categoría,
    subcategoría y contexto), usando como contexto el árbol de categorías y el
    historial reciente. Devuelve (datos, cat_tree).
    """
    print("🧠 Obteniendo contexto desde Firestore...")
    cat_tree, cuentas, monedas, recientes, memoria = _prefetch_context(db)
    nombres_categorias = [c['name'] for c in cat_tree]
    memoria_prompt = memory_for_prompt(memoria)

    prompt = f"""Eres un experto asistente financiero que lee correos de notificaciones bancarias.
Extrae los datos de la transacción descrita en el correo y devuelve ÚNICAMENTE un objeto JSON válido.
Ignora firmas, saludos, publicidad o información legal. Céntrate en la transacción (quién cobró y cuánto).
Si el correo es una notificación de un pago que TÚ hiciste, type = 'debit'.

¡MUY IMPORTANTE! Devuelve únicamente {{"type": "ignore"}} si el correo:
- indica que la transacción "no fue exitosa", fue "Rechazada", "Fallida", "Declinada", etc.; o
- NO es una transacción individual: extractos / estados de cuenta, resúmenes mensuales,
  alertas de saldo o de cupo disponible, códigos OTP, publicidad o avisos de seguridad.

Categorías disponibles (cada una con sus subcategorías válidas):
{json.dumps(cat_tree, ensure_ascii=False, indent=2)}

Cuentas/tarjetas disponibles: {cuentas}
Monedas disponibles: {monedas}

Memoria de comercios (clasificación HABITUAL por comercio — úsala como prior fuerte para
categoría, subcategoría y contexto, y para imitar cómo se suele titular cada comercio):
{json.dumps(memoria_prompt, ensure_ascii=False, indent=2)}

Transacciones recientes (muestra adicional para inferir contexto):
{json.dumps(recientes, ensure_ascii=False, indent=2)}

Reglas para los campos:
- type: 'debit' (gasto), 'credit' (ingreso) o 'ignore' (fallida/declinada o no-transacción).
- amount: el monto numérico exacto, positivo y sin símbolos de moneda.
- title: un resumen muy corto del concepto/comercio. Si el comercio aparece en la memoria, titúlalo igual que ahí.
- currency: elige una opción de {monedas}, o 'COP' si el texto usa $, pesos, etc.
- category: elige una opción de {nombres_categorias}. Si no aplica ninguna, usa 'Otros'.
- subcategory: elige una subcategoría VÁLIDA de la categoría que elegiste (ver lista de arriba). Si ninguna aplica o esa categoría no tiene subcategorías, usa "".
- card: elige una opción de {cuentas} según la data del correo.
- context: 'personal' o 'business'. Infiérelo del título, el correo y el historial; por defecto 'personal'.
- comments: nota con el DETALLE concreto que aparezca en el correo, no un genérico. Si el correo
  lista productos (p. ej. un domicilio), enuméralos; si es un transporte e incluye origen/destino, ponlos;
  si es una transferencia, indica la contraparte (quién envía o recibe). Si el correo no trae detalle
  específico, resume brevemente la transacción.

Texto del correo:
"{texto}"

Devuelve solo el JSON, sin explicación ni markdown. Formato esperado:
{{"type": "", "amount": 0, "title": "", "currency": "", "category": "", "subcategory": "", "card": "", "context": "", "comments": ""}}

Si la transacción no fue exitosa o no es una transacción individual, devuelve únicamente:
{{"type": "ignore"}}
"""

    print(f"🧠 Analizando correo con Gemini ({GEMINI_MODEL})...")
    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction="Eres un asistente financiero. Respondes únicamente con un objeto JSON válido.",
                response_mime_type="application/json",
                temperature=0,
            ),
        )
        datos_extraidos = json.loads(response.text)
        print("✅ Análisis JSON completado con éxito.")

        # Post-corrección determinista: si el comercio es conocido y consistente,
        # fijamos la clasificación desde la memoria (no toca amount/title/comments).
        datos_extraidos, info = apply_merchant_memory(datos_extraidos, memoria)
        if info:
            print(f"🧩 Memoria de comercios ajustó {list(info['changed'])} para '{info['merchant']}' (visto {info['count']}×).")

        # Validación contra catálogos (categoría válida, cuenta válida).
        datos_extraidos = validate_classification(datos_extraidos, nombres_categorias, cuentas)
        return datos_extraidos, cat_tree
    except Exception as e:
        print(f"\n❌ Error analizando o interpretando la respuesta de Gemini: {e}")
        return None, cat_tree


def registrar_transaccion(datos_ia, tx_dt, db, cat_tree, dry_run=False):
    """Guarda la transacción extraída por la IA en Firestore.

    `tx_dt` es el datetime (tz Colombia) del momento del correo bancario, que
    usamos como verdad para la fecha Y la hora. No dependemos de la fecha que
    extrae el LLM (poco fiable y propensa a confundir el día).

    Con `dry_run=True` arma y muestra la transacción pero NO escribe en
    Firestore ni envía push (para pruebas en producción sin tocar la data).
    """
    # Manejar transacciones declinadas
    if datos_ia.get('type') == 'ignore':
        print("⏭️ La IA determinó que la transacción fue fallida/declinada o que no es una transacción. Ignorando guardado.")
        return True  # Devolvemos True para que de todas formas se quite la etiqueta

    # Fecha (solo día) y timestamp (día + hora) derivados del correo, en hora local.
    tx_date = tx_dt.strftime("%Y-%m-%d")

    # Sanitizar category: la IA puede devolver un objeto en vez de string
    raw_category = datos_ia.get('category', 'general')
    if isinstance(raw_category, dict):
        raw_category = raw_category.get('name', 'general')
    category = str(raw_category) if raw_category else 'general'

    # Validar subcategory contra las subcategorías válidas de la categoría elegida
    subcategory = datos_ia.get('subcategory', '') or ''
    valid_subs = []
    for c in cat_tree:
        if c['name'] == category:
            valid_subs = c.get('subcategories', [])
            break
    if subcategory and valid_subs and subcategory not in valid_subs:
        print(f"⚠️ La IA devolvió la subcategoría '{subcategory}', inválida para '{category}'. Se ignora.")
        subcategory = ''

    # Validar context
    context = datos_ia.get('context', 'personal')
    if context not in ('personal', 'business'):
        print(f"⚠️ La IA devolvió un contexto inválido '{context}'. Se usa 'personal'.")
        context = 'personal'

    nueva_transaccion = {
        "type": datos_ia.get('type', 'debit'),
        "amount": float(datos_ia.get('amount', 0)),
        "currency": datos_ia.get('currency', 'COP'),
        "title": datos_ia.get('title', 'Sin concepto especificado'),
        "category": category,
        "subcategory": subcategory,
        "card": datos_ia.get('card', 'general'),
        "comments": datos_ia.get('comments', "Importado automáticamente desde Gmail vía IA"),
        "context": context,
        "date": tx_date,
        # Momento real (día + hora) de la transacción, en hora local de Colombia.
        # Se usa para ordenar; la UI no lo muestra. Firestore lo guarda como Timestamp.
        "timestamp": tx_dt,
        # Las transacciones importadas automáticamente requieren revisión
        # manual en la app; se marcan como 'reviewed' al editarlas/guardarlas.
        "status": "pending",
    }

    print("\n📦 Datos a guardar en Firebase:")
    for k, v in nueva_transaccion.items():
        print(f"   {k}: {v}")

    if dry_run:
        print("🧪 DRY-RUN: no se escribe en Firebase ni se envía push.")
        return True

    try:
        _, doc_ref = db.collection('finance_transactions').add(nueva_transaccion)
        print(f"✅ Éxito: Registro guardado en Firebase (ID: {doc_ref.id})")
        # El push es best-effort: nunca debe romper el sync.
        try:
            enviar_push_pending(db, doc_ref.id, nueva_transaccion)
        except Exception as e:
            print(f"⚠️ No se pudo enviar la notificación push (no crítico): {e}")
        # El aporte al Fondo de Seguridad también es best-effort: si falla no
        # debe hacer que el ingreso original se dé por no guardado.
        if nueva_transaccion['type'] == 'credit':
            try:
                registrar_aporte_fondo10(db, nueva_transaccion)
            except Exception as e:
                print(f"⚠️ No se pudo registrar el aporte automático al Fondo de Seguridad (no crítico): {e}")
        return True
    except Exception as e:
        print(f"❌ Error al guardar en Firebase: {e}")
        return False


def get_fondo10_config(db):
    """Config del Fondo de Seguridad Financiera (cuenta, %, activo/inactivo),
    editable en finance_settings/default junto a gmailLabel. Fallback a los
    valores por defecto si el documento no existe o Firestore no responde."""
    try:
        doc = db.collection('finance_settings').document('default').get()
        if doc.exists:
            data = doc.to_dict()
            cuenta = (data.get('fondo10Cuenta') or '').strip() or FONDO10_CUENTA
            porcentaje = data.get('fondo10Porcentaje', FONDO10_PORCENTAJE)
            activo = data.get('fondo10Activo', True)
            return cuenta, float(porcentaje), bool(activo)
    except Exception as e:
        print(f"⚠️ No se pudo leer la config del Fondo de Seguridad de Firestore ({e}); uso valores por defecto.")
    return FONDO10_CUENTA, FONDO10_PORCENTAJE, True


def registrar_aporte_fondo10(db, tx):
    """Al guardar un ingreso real, aparta automáticamente un % hacia el Fondo
    de Seguridad Financiera como una Transferencia — el mismo mecanismo que
    usa la app cuando el usuario transfiere entre cuentas a mano. Nunca se
    aplica a gastos, ni al propio fondo aportándose sobre sí mismo (ej. un
    rendimiento que caiga directo en esa cuenta)."""
    cuenta_fondo, porcentaje, activo = get_fondo10_config(db)
    if not activo or not porcentaje or not cuenta_fondo:
        return
    if tx.get('card') == cuenta_fondo:
        return

    aporte = round(float(tx['amount']) * porcentaje / 100)
    if aporte <= 0:
        return

    aporte_doc = {
        "title": f"Aporte automático {porcentaje:g}% — Fondo de Seguridad",
        "amount": aporte,
        "currency": tx.get('currency', 'COP'),
        "type": "transfer",
        "context": tx.get('context', 'personal'),
        "destinationContext": tx.get('context', 'personal'),
        "category": "Financiero y Deudas",
        "subcategory": "",
        "card": tx.get('card', 'general'),
        "destinationCard": cuenta_fondo,
        "comments": f"{porcentaje:g}% de \"{tx.get('title', 'ingreso')}\" apartado automáticamente.",
        "date": tx.get('date'),
        "timestamp": tx.get('timestamp'),
        "status": "reviewed",
    }
    _, ref = db.collection('finance_transactions').add(aporte_doc)
    print(f"💰 Aporte automático de {aporte} {aporte_doc['currency']} registrado al Fondo de Seguridad (ID: {ref.id}).")


def enviar_push_pending(db, tx_id, tx):
    """Notifica por push (Web Push/FCM) que entró un movimiento pendiente.

    Lee todos los tokens registrados por la app web en la colección
    `fcm_tokens` (doc id == token) y envía un mensaje data-only para que el
    service worker controle la presentación y el deep link `?editTx=<id>`.
    Limpia los tokens que FCM reporta como inválidos.
    """
    tokens = [d.id for d in db.collection('fcm_tokens').stream()]
    if not tokens:
        print("ℹ️ No hay dispositivos suscritos a notificaciones. Se omite push.")
        return

    signo = '-' if tx.get('type') == 'debit' else '+'
    try:
        monto = f"{signo}{float(tx.get('amount', 0)):,.0f} {tx.get('currency', 'COP')}"
    except (TypeError, ValueError):
        monto = tx.get('currency', 'COP')
    titulo = tx.get('title', 'Movimiento')
    categoria = tx.get('category', '')
    body = f"{monto} · {titulo}" + (f" · {categoria}" if categoria else "")
    url = f"/?editTx={tx_id}"

    message = messaging.MulticastMessage(
        tokens=tokens,
        # Data-only: el SW arma la notificación (evita duplicados en Chrome).
        data={
            'txId': str(tx_id),
            'url': url,
            'title': '🧾 Pendiente de revisión',
            'body': body,
        },
        # Sin fcm_options.link: FCM exige URL absoluta HTTPS ahí, pero el deep
        # link lo resuelve nuestro service worker desde data.url (relativo OK).
        webpush=messaging.WebpushConfig(
            headers={'Urgency': 'high'},
        ),
    )

    response = messaging.send_each_for_multicast(message)
    print(f"🔔 Push enviado: {response.success_count} ok, {response.failure_count} fallidos.")

    for token, resp in zip(tokens, response.responses):
        if resp.success:
            continue
        exc = resp.exception
        if isinstance(exc, messaging.UnregisteredError) or 'not-registered' in str(getattr(exc, 'code', '')).lower():
            db.collection('fcm_tokens').document(token).delete()
            print(f"🧹 Token inválido eliminado: {token[:12]}…")


def mark_as_processed(service, msg_id, label_id_to_remove):
    """Remueve la etiqueta del correo en Gmail."""
    try:
        service.users().messages().modify(
            userId='me',
            id=msg_id,
            body={'removeLabelIds': [label_id_to_remove]}
        ).execute()
        print(f"✅ Etiqueta removida del correo {msg_id}")
    except Exception as e:
        print(f"⚠️ Error intentando remover etiqueta: {e}")


def reprocess_last_emails(db, service, client, n, dry_run):
    """Modo PRUEBA: re-procesa los últimos N correos ya procesados (ordenados por
    processedAt). Pensado para validar el pipeline en producción tras un merge,
    sin esperar a un correo real. Con dry_run=True NO escribe en Firestore, NO
    envía push y NO toca etiquetas de Gmail.
    """
    modo = "DRY-RUN (no escribe nada)" if dry_run else "⚠️ ESCRIBE en Firestore"
    print(f"🧪 Modo prueba — re-procesando los últimos {n} correos procesados · {modo}")

    docs = db.collection(PROCESSED_COLLECTION) \
        .order_by('processedAt', direction=firestore.Query.DESCENDING) \
        .limit(n).get()
    ids = [d.id for d in docs]
    if not ids:
        print("⚠️ No hay correos en el historial de procesados.")
        return

    for i, msg_id in enumerate(ids, 1):
        print("\n" + "-" * 50)
        print(f"📩 [{i}/{len(ids)}] Re-procesando correo {msg_id}")
        try:
            message_data = service.users().messages().get(userId='me', id=msg_id, format='full').execute()
        except Exception as e:
            print(f"⚠️ No se pudo traer el correo {msg_id} desde Gmail: {e}")
            continue

        payload = message_data.get('payload', {})
        subject = next((h.get('value', '') for h in payload.get('headers', [])
                        if h.get('name', '').lower() == 'subject'), '')
        if looks_like_statement(subject):
            print(f"🚫 Sería ignorado por el gate de extractos ('{subject[:60]}').")
            continue

        internal_date_ms = int(message_data.get('internalDate', 0))
        tx_dt = (
            datetime.datetime.fromtimestamp(internal_date_ms / 1000.0, tz=BOGOTA)
            if internal_date_ms else datetime.datetime.now(BOGOTA)
        )

        body_text = extract_email_body(payload)
        if not body_text:
            print(f"⚠️ No se pudo extraer texto legible del correo {msg_id}")
            continue

        datos_ia, cat_tree = procesar_texto_con_ia(body_text[:MAX_BODY_CHARS], db, client)
        if datos_ia:
            registrar_transaccion(datos_ia, tx_dt, db, cat_tree, dry_run=dry_run)
        else:
            print(f"⚠️ El correo {msg_id} falló en la interpretación por IA.")

    print("\n🧪 Fin del modo prueba.")


def get_configured_label(db):
    """Etiqueta configurada en la app (Settings → Finanzas), con fallback a la
    de por defecto si el campo no existe, está vacío o Firestore no responde."""
    try:
        doc = db.collection('finance_settings').document('default').get()
        if doc.exists:
            label = (doc.to_dict().get('gmailLabel') or '').strip()
            if label:
                return label
    except Exception as e:
        print(f"⚠️ No se pudo leer gmailLabel de Firestore ({e}); uso '{DEFAULT_LABEL}'.")
    return DEFAULT_LABEL


def main():
    parser = argparse.ArgumentParser(description="Automatización de Gmail a Firestore con Gemini")
    parser.add_argument('--label', default=None,
                        help="Nombre de la etiqueta en Gmail. Si se omite, usa gmailLabel de "
                             f"finance_settings/default en Firestore, o '{DEFAULT_LABEL}'.")
    parser.add_argument('--reprocess-last', type=int, default=0, metavar='N',
                        help="Modo PRUEBA: re-procesa los últimos N correos ya procesados (no toca la etiqueta).")
    parser.add_argument('--dry-run', action='store_true',
                        help="No escribe en Firestore ni envía push. Úsalo con --reprocess-last para validar tras un merge.")
    args = parser.parse_args()

    gemini_key = os.environ.get('GEMINI_API_KEY')
    if not gemini_key:
        print("❌ Falta la variable de entorno GEMINI_API_KEY.")
        raise SystemExit(1)
    client = genai.Client(api_key=gemini_key)

    db = conectar_db()

    print("🔑 Iniciando conexión con Gmail...")
    service = authenticate_gmail(db)

    # Modo prueba: re-procesar los últimos N correos (validar el pipeline en
    # producción tras un merge, idealmente con --dry-run).
    if args.reprocess_last > 0:
        reprocess_last_emails(db, service, client, args.reprocess_last, args.dry_run)
        return

    label_name = args.label or get_configured_label(db)
    print(f"🔍 Buscando el ID interno para la etiqueta '{label_name}'...")
    label_id = get_label_id(service, label_name)
    if not label_id:
        print(f"❌ No se encontró la etiqueta '{label_name}' en tu cuenta de Gmail.")
        print("Asegúrate de haberla creado en la interfaz de Gmail.")
        return
    print(f"✅ Etiqueta encontrada en servidor: {label_id}")

    print(f"📫 Buscando correos con la etiqueta '{label_name}'...")
    query = f"label:{label_name}"
    results = service.users().messages().list(userId='me', q=query).execute()
    messages = results.get('messages', [])

    if not messages:
        print("✅ No se encontraron correos pendientes para procesar.")
        return

    for msg in messages:
        msg_id = msg['id']

        if is_processed(db, msg_id):
            print(f"⏭️ El correo {msg_id} ya fue procesado pero sigue etiquetado. Removiendo etiqueta...")
            mark_as_processed(service, msg_id, label_id)
            continue

        print("\n" + "-" * 50)
        print(f"📩 Procesando nuevo correo: {msg_id}")

        # Descargar el correo completo
        message_data = service.users().messages().get(userId='me', id=msg_id, format='full').execute()
        payload = message_data.get('payload', {})

        # Extractos de deuda (PDF cifrado): se detectan por remitente y se
        # procesan por su propio pipeline (desencriptar → Gemini → Firestore),
        # ANTES del gate de "no es transacción" — si no, se descartarían ahí.
        sender = _sender_email(payload)
        if sender in EXTRACTO_DEBT_SENDERS:
            entidad = EXTRACTO_DEBT_SENDERS[sender]
            print(f"💳 Detectado extracto de deuda de {entidad} ({sender}). Procesando aparte...")
            if procesar_correo_extracto_deuda(db, service, client, msg_id, payload, entidad):
                mark_as_processed(service, msg_id, label_id)
                save_processed_email(db, msg_id)
            else:
                print(f"⚠️ El extracto de {entidad} no se pudo procesar. Se mantendrá la etiqueta para reintentar luego.")
            continue

        # Gate barato pre-LLM: los extractos / estados de cuenta no son
        # transacciones individuales. Se detectan por asunto y se descartan
        # sin gastar una llamada al modelo.
        subject = next((h.get('value', '') for h in payload.get('headers', [])
                        if h.get('name', '').lower() == 'subject'), '')
        if looks_like_statement(subject):
            print(f"🚫 El correo parece un extracto/estado de cuenta ('{subject[:60]}'). Se ignora sin llamar al LLM.")
            mark_as_processed(service, msg_id, label_id)
            save_processed_email(db, msg_id)
            continue

        # Momento del correo (≈ momento de la transacción) en hora local de Colombia.
        # internalDate viene en epoch ms UTC; lo convertimos a UTC-5 (Colombia no
        # tiene horario de verano). De aquí salen la fecha y la hora que guardamos.
        internal_date_ms = int(message_data.get('internalDate', 0))
        tx_dt = (
            datetime.datetime.fromtimestamp(internal_date_ms / 1000.0, tz=BOGOTA)
            if internal_date_ms else datetime.datetime.now(BOGOTA)
        )

        body_text = extract_email_body(payload)
        if not body_text:
            print(f"⚠️ No se pudo extraer texto legible del correo {msg_id}")
            # Lo marcamos procesado de todas formas para no ciclar en correos vacíos
            mark_as_processed(service, msg_id, label_id)
            save_processed_email(db, msg_id)
            continue

        # Limitar el tamaño del texto enviado al modelo
        truncated_text = body_text[:MAX_BODY_CHARS]
        print(f"📄 Texto detectado (resumen): {truncated_text[:100].replace(chr(10), ' ')}...")

        datos_ia, cat_tree = procesar_texto_con_ia(truncated_text, db, client)

        if datos_ia:
            success = registrar_transaccion(datos_ia, tx_dt, db, cat_tree)
            if success:
                mark_as_processed(service, msg_id, label_id)
                save_processed_email(db, msg_id)
        else:
            print(f"⚠️ El correo {msg_id} falló en la interpretación por IA. Se mantendrá la etiqueta para reintentar luego.")


if __name__ == '__main__':
    main()
