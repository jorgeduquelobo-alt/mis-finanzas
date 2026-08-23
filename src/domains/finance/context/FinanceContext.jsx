import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { db } from '../../../firebase';
import { collection, onSnapshot, addDoc, doc, setDoc, getDoc, Timestamp, deleteDoc, updateDoc } from 'firebase/firestore';
import { normalizeCategory, parseTransactionDate, calculateBalances } from '../utils/financeHelpers';

const FinanceContext = createContext();

// eslint-disable-next-line react-refresh/only-export-components
export const useFinance = () => useContext(FinanceContext);

const DEFAULT_CONFIG = {
    currencies: ['COP', 'USD', 'EUR'],
    accounts: ['Efectivo', 'Tarjeta de Crédito Principal', 'Cuenta Bancaria', 'Fondo de Seguridad Financiera'],
    // Config de instancia (editable en Settings → Finanzas)
    gmailLabel: 'Bancos/PendingBot',
    exchangeRate: 4100,
    // Fondo de Seguridad Financiera: al registrar un ingreso real (type
    // 'credit'), se aparta automáticamente este % hacia `fondo10Cuenta` como
    // una Transferencia. Nunca aplica a gastos. fondo10Activo permite
    // apagarlo sin borrar la configuración.
    fondo10Cuenta: 'Fondo de Seguridad Financiera',
    fondo10Porcentaje: 10,
    fondo10Activo: true,
    categories: [
        { name: 'Hogar', subcategories: ['Arriendo', 'Servicios Públicos', 'Internet', 'Plan Celular', 'Mercado', 'Aseo', 'Mantenimiento', 'Muebles', 'Utensilios y accesorios'], icon: 'home', type: 'debit', context: 'personal' },
        { name: 'Comida', subcategories: ['Domicilios / Rappi', 'Restaurantes / Cafés'], icon: 'restaurant', type: 'debit', context: 'personal' },
        { name: 'Transporte', subcategories: ['Uber / Taxi', 'Metro / Bus', 'Gasolina / Peajes', 'Mantenimiento Vehículo', 'Vuelos', 'Alquiler Vehiculo', 'Parqueadero'], icon: 'directions_car', type: 'debit', context: 'personal' },
        { name: 'Salud y Bienestar', subcategories: ['Citas Médicas / Copagos', 'Medicamentos / Farmacia', 'Cuidado Personal (Barbería, peluquería, masajes)', 'Gym'], icon: 'fitness_center', type: 'debit', context: 'personal' },
        { name: 'Estilo de Vida y Ocio', subcategories: ['Citas / Pareja', 'Suscripciones', 'Compras / Ropa / Gadgets', 'Entretenimiento (Cine, conciertos, rumba)', 'Regalos'], icon: 'shopping_bag', type: 'debit', context: 'personal' },
        { name: 'Financiero y Deudas', subcategories: ['Intereses / Comisiones', 'Seguros', 'Impuestos Personales', 'Prestamo', 'Pago a Créditos', 'Pago a Tarjetas'], icon: 'account_balance', type: 'debit', context: 'personal' },
        { name: 'Ingresos', subcategories: ['Salario', 'Ventas', 'Rendimientos / Intereses', 'Cashbacks / Devoluciones'], icon: 'payments', type: 'credit', context: 'both' },
        { name: 'Operación', subcategories: ['SaaS / Software', 'Equipos / Máquinas', 'Materiales / Insumos', 'Nómina', 'Impuestos (IVA, Renta)', 'Comisiones Bancarias / Pasarelas de Pago', 'Procesamiento'], icon: 'storefront', type: 'debit', context: 'business' }
    ]
};

export const FinanceProvider = ({ children }) => {
    const [transactions, setTransactions] = useState([]);
    const [budgets, setBudgets] = useState({});
    const [goals, setGoals] = useState([]);
    const [loading, setLoading] = useState(true);
    const [currentContext, setCurrentContext] = useState('unified');

    // Global Config State
    const [appConfig, setAppConfig] = useState(DEFAULT_CONFIG);

    useEffect(() => {
        // Fetch Settings Configuration
        const fetchConfig = async () => {
            try {
                const configRef = doc(db, 'finance_settings', 'default');
                const configSnap = await getDoc(configRef);

                if (configSnap.exists()) {
                    const data = configSnap.data();
                    let needsMigration = false;
                    let migratedCategories = data.categories || [];

                    // Migration: Check if categories need migration
                    if (migratedCategories.length > 0) {
                        migratedCategories = migratedCategories.map(cat => {
                            if (typeof cat === 'string') {
                                needsMigration = true;
                                const isIncome = cat.toLowerCase().includes('ingreso');
                                return {
                                    name: cat,
                                    subcategories: [],
                                    icon: 'category',
                                    type: isIncome ? 'credit' : 'debit',
                                    context: 'personal'
                                };
                            } else if (typeof cat === 'object') {
                                // Check if any fields are missing
                                let updatedCat = { ...cat };
                                if (!updatedCat.icon || !updatedCat.type || !updatedCat.context) {
                                    needsMigration = true;
                                    const isIncome = (updatedCat.name || '').toLowerCase().includes('ingreso');
                                    updatedCat.icon = updatedCat.icon || 'category';
                                    updatedCat.type = updatedCat.type || (isIncome ? 'credit' : 'debit');
                                    updatedCat.context = updatedCat.context || 'personal';
                                }
                                return updatedCat;
                            }
                            return cat;
                        });
                    }

                    if (needsMigration) {
                        const migratedConfig = { ...data, categories: migratedCategories };
                        setAppConfig(migratedConfig);
                        // Update Firestore immediately to migrate persistence
                        await updateDoc(configRef, { categories: migratedCategories });
                    } else {
                        setAppConfig(data);
                    }
                } else {
                    // Initialize default if it doesn't exist
                    await setDoc(configRef, DEFAULT_CONFIG);
                }
            } catch (error) {
                console.error("Error fetching config: ", error);
                // Do not set loading false here, wait for transactions
            }
        };

        fetchConfig();

        // Subscribe to transactions collection
        const unsubscribeTransactions = onSnapshot(collection(db, 'finance_transactions'), (snapshot) => {
            const txs = snapshot.docs.map(doc => {
                const data = doc.data();
                const date = parseTransactionDate(data.date);
                const category = normalizeCategory(data.category);

                // sortAt = día del campo `date` (lo que se muestra) + hora real del
                // `timestamp` (si existe). Así ordenamos por fecha Y hora sin afectar
                // el día mostrado (incluye registros con fecha retroactiva).
                let sortAt = date;
                if (data.timestamp && typeof data.timestamp.toDate === 'function') {
                    const ts = data.timestamp.toDate();
                    sortAt = new Date(
                        date.getFullYear(), date.getMonth(), date.getDate(),
                        ts.getHours(), ts.getMinutes(), ts.getSeconds(), ts.getMilliseconds()
                    );
                }

                return {
                    id: doc.id,
                    ...data,
                    category,
                    date,
                    sortAt,
                };
            });

            // Ordenar por fecha+hora descendente (más reciente primero)
            txs.sort((a, b) => b.sortAt.getTime() - a.sortAt.getTime());
            setTransactions(txs);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching transactions:", error);
            setLoading(false); // Make sure it stops loading even on error
        });

        // Subscribe to goals collection
        const unsubscribeGoals = onSnapshot(collection(db, 'finance_goals'), (snapshot) => {
            const goalsData = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
            }));
            setGoals(goalsData);
        }, (error) => {
            console.error("Error fetching goals:", error);
        });

        // Cleanup subscriptions on unmount
        return () => {
            unsubscribeTransactions();
            unsubscribeGoals();
        }
    }, []);

    const updateAppConfig = useCallback(async (newConfig) => {
        try {
            const configRef = doc(db, 'finance_settings', 'default');
            await setDoc(configRef, newConfig);
            setAppConfig(newConfig);
        } catch (error) {
            console.error("Error updating config: ", error);
            throw error;
        }
    }, []);

    // Aparta automáticamente un % de un ingreso real hacia el Fondo de
    // Seguridad Financiera, como una Transferencia — el mismo mecanismo que
    // usa la app cuando el usuario transfiere entre cuentas a mano. Nunca se
    // aplica a gastos, y nunca se aplica sobre el propio fondo (evita que un
    // rendimiento del fondo se vuelva a apartar sobre sí mismo). Best-effort:
    // si falla, no debe impedir que el ingreso original se haya guardado.
    const registrarAporteFondo10 = useCallback(async (tx) => {
        const cuentaFondo = (appConfig.fondo10Cuenta || DEFAULT_CONFIG.fondo10Cuenta || '').trim();
        const porcentaje = Number(appConfig.fondo10Porcentaje ?? DEFAULT_CONFIG.fondo10Porcentaje);
        const activo = appConfig.fondo10Activo !== false; // activo por defecto si no está configurado
        if (!activo || !porcentaje || !cuentaFondo || tx.card === cuentaFondo) return;

        const aporte = Math.round(Number(tx.amount) * porcentaje / 100);
        if (!aporte || aporte <= 0) return;

        await addDoc(collection(db, 'finance_transactions'), {
            title: `Aporte automático ${porcentaje}% — Fondo de Seguridad`,
            amount: aporte,
            currency: tx.currency || 'COP',
            type: 'transfer',
            context: tx.context || 'personal',
            destinationContext: tx.context || 'personal',
            category: 'Financiero y Deudas',
            subcategory: '',
            card: tx.card || 'general',
            destinationCard: cuentaFondo,
            comments: `${porcentaje}% de "${tx.title || 'ingreso'}" apartado automáticamente.`,
            date: tx.date,
            timestamp: Timestamp.now(),
            status: 'reviewed',
        });
    }, [appConfig]);

    const addTransaction = useCallback(async (data) => {
        try {
            const today = new Date();
            const year = today.getFullYear();
            const month = String(today.getMonth() + 1).padStart(2, '0');
            const day = String(today.getDate()).padStart(2, '0');
            const defaultDateStr = `${year}-${month}-${day}`;

            const txData = {
                date: defaultDateStr,
                timestamp: Timestamp.now(),
                status: 'reviewed',
                ...data,
            };
            await addDoc(collection(db, 'finance_transactions'), txData);

            if (txData.type === 'credit') {
                try {
                    await registrarAporteFondo10(txData);
                } catch (error) {
                    console.error("Error registrando el aporte automático al Fondo de Seguridad (no crítico): ", error);
                }
            }
        } catch (error) {
            console.error("Error adding document: ", error);
            throw error;
        }
    }, [registrarAporteFondo10]);

    const addTransfer = useCallback(async (transferData) => {
        try {
            const today = new Date();
            const year = today.getFullYear();
            const month = String(today.getMonth() + 1).padStart(2, '0');
            const day = String(today.getDate()).padStart(2, '0');
            const defaultDateStr = `${year}-${month}-${day}`;

            await addDoc(collection(db, 'finance_transactions'), {
                title: transferData.title || 'Transferencia',
                amount: Number(transferData.amount),
                type: 'transfer',
                context: transferData.sourceContext,
                destinationContext: transferData.destinationContext,
                category: transferData.category || 'Financiero y Deudas',
                subcategory: transferData.subcategory || '',
                currency: transferData.currency,
                card: transferData.sourceAccount,
                destinationCard: transferData.destinationAccount,
                comments: transferData.comments || '',
                date: transferData.date || defaultDateStr,
                timestamp: Timestamp.now(),
                status: 'reviewed',
            });
        } catch (error) {
            console.error("Error adding transfer: ", error);
            throw error;
        }
    }, []);

    const deleteTransaction = useCallback(async (id) => {
        try {
            await deleteDoc(doc(db, 'finance_transactions', id));
        } catch (error) {
            console.error("Error deleting document: ", error);
            throw error;
        }
    }, []);

    const updateTransaction = useCallback(async (id, data) => {
        try {
            await updateDoc(doc(db, 'finance_transactions', id), { ...data });
        } catch (error) {
            console.error("Error updating document: ", error);
            throw error;
        }
    }, []);

    // Memoize global balance calculations to avoid re-computing on every render/call
    const balances = useMemo(() => calculateBalances(transactions), [transactions]);

    // Calculate balances based on context and transaction type
    const getTotals = useCallback((contextFilter) => {
        // filter transactions based on context ('personal', 'business' or 'unified')
        const filtered = transactions.filter(t =>
            contextFilter === 'unified' ? true : t.context === contextFilter
        );

        return {
            ...balances,
            filteredTransactions: filtered
        };
    }, [transactions, balances]);

    // --- Metas / Goals Methods ---
    const addGoal = useCallback(async (data) => {
        try {
            await addDoc(collection(db, 'finance_goals'), data);
        } catch (error) {
            console.error("Error adding goal: ", error);
            throw error;
        }
    }, []);

    const updateGoal = useCallback(async (id, data) => {
        try {
            await updateDoc(doc(db, 'finance_goals', id), data);
        } catch (error) {
            console.error("Error updating goal: ", error);
            throw error;
        }
    }, []);

    const deleteGoal = useCallback(async (id) => {
        try {
            await deleteDoc(doc(db, 'finance_goals', id));
        } catch (error) {
            console.error("Error deleting goal: ", error);
            throw error;
        }
    }, []);

    // --- Presupuestos / Budgets Methods (Automatic Cloning) ---
    // Fetch budget for a specific month and context. If not found, attempts to clone the previous month.
    const fetchBudgetConfig = useCallback(async (monthStr, context) => {
        try {
            const budgetId = `${monthStr}_${context}`;
            const budgetRef = doc(db, 'finance_budgets', budgetId);
            const budgetSnap = await getDoc(budgetRef);

            if (budgetSnap.exists()) {
                const data = budgetSnap.data();
                setBudgets(prev => ({ ...prev, [budgetId]: data }));
                return data;
            } else {
                // Not found. Attempt cloning.
                // Expected monthStr format: YYYY-MM
                const [year, month] = monthStr.split('-');
                let prevDate = new Date(year, parseInt(month) - 1 - 1, 1); // -1 for 0 index, -1 for previous month
                if (isNaN(prevDate)) return null;

                const prevYYYY = prevDate.getFullYear();
                const prevMM = String(prevDate.getMonth() + 1).padStart(2, '0');
                const prevMonthStr = `${prevYYYY}-${prevMM}`;
                const prevBudgetId = `${prevMonthStr}_${context}`;

                const prevBudgetRef = doc(db, 'finance_budgets', prevBudgetId);
                const prevBudgetSnap = await getDoc(prevBudgetRef);

                if (prevBudgetSnap.exists()) {
                    const clonedData = prevBudgetSnap.data();

                    // Save the cloned data directly as the new month's config
                    await setDoc(budgetRef, clonedData);
                    setBudgets(prev => ({ ...prev, [budgetId]: clonedData }));
                    return clonedData;
                }

                // If previous doesn't exist either, return empty setup
                return null;
            }
        } catch (error) {
            console.error("Error in fetchBudgetConfig: ", error);
            return null;
        }
    }, []);

    const saveBudgetConfig = useCallback(async (monthStr, context, newCategories) => {
        try {
            const budgetId = `${monthStr}_${context}`;
            const budgetRef = doc(db, 'finance_budgets', budgetId);
            const dataToSave = {
                month: monthStr,
                context: context,
                categories: newCategories,
                updatedAt: Timestamp.now()
            };

            await setDoc(budgetRef, dataToSave);
            setBudgets(prev => ({ ...prev, [budgetId]: dataToSave }));
        } catch (error) {
            console.error("Error saving budget config: ", error);
            throw error;
        }
    }, []);


    const value = useMemo(() => ({
        transactions,
        budgets,
        goals,
        loading,
        currentContext,
        setCurrentContext,
        addTransaction,
        addTransfer,
        deleteTransaction,
        updateTransaction,
        getTotals,
        appConfig,
        updateAppConfig,
        addGoal,
        updateGoal,
        deleteGoal,
        fetchBudgetConfig,
        saveBudgetConfig,
    }), [
        transactions, budgets, goals, loading, currentContext, getTotals, appConfig,
        addTransaction, addTransfer, deleteTransaction, updateTransaction,
        updateAppConfig, addGoal, updateGoal, deleteGoal, fetchBudgetConfig, saveBudgetConfig,
    ]);

    return (
        <FinanceContext.Provider value={value}>
            {children}
        </FinanceContext.Provider>
    );
};
