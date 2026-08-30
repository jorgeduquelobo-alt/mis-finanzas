import React, { useState, useEffect } from 'react';
import { useFinance } from '../context/FinanceContext';
import { Icon, Field } from '../../../shared/ds/Primitives';

const INPUT_STYLE = {
    width: '100%', padding: '10px 14px',
    background: 'var(--bg-sunken)',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--r-lg)',
    fontFamily: 'var(--font-sans)', fontSize: 14,
    color: 'var(--fg-1)', outline: 'none',
    boxSizing: 'border-box',
};

export default function CostoFijoModal({ isOpen, onClose, currentContext, editingCostoFijo }) {
    const { addFixedCost, updateFixedCost, deleteFixedCost } = useFinance();
    const [formData, setFormData] = useState({
        nombre: '',
        monto: '',
        diaVencimiento: '',
        contexto: currentContext || 'personal',
    });

    useEffect(() => {
        if (editingCostoFijo) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setFormData({
                nombre: editingCostoFijo.nombre || '',
                monto: editingCostoFijo.monto || '',
                diaVencimiento: editingCostoFijo.diaVencimiento || '',
                contexto: editingCostoFijo.contexto || currentContext || 'personal',
            });
        } else {
            setFormData({
                nombre: '',
                monto: '',
                diaVencimiento: '',
                contexto: currentContext === 'unified' ? 'personal' : (currentContext || 'personal'),
            });
        }
    }, [editingCostoFijo, currentContext]);

    if (!isOpen) return null;

    const set = (key, val) => setFormData(prev => ({ ...prev, [key]: val }));

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const dataToSave = {
                nombre: formData.nombre.trim(),
                monto: Number(formData.monto),
                diaVencimiento: Number(formData.diaVencimiento),
                contexto: formData.contexto,
            };
            if (editingCostoFijo) {
                await updateFixedCost(editingCostoFijo.id, dataToSave);
            } else {
                await addFixedCost(dataToSave);
            }
            onClose();
        } catch (error) {
            console.error("Error saving fixed cost:", error);
        }
    };

    const handleDelete = async () => {
        if (!editingCostoFijo) return;
        if (!window.confirm(`¿Eliminar el costo fijo "${editingCostoFijo.nombre}"?`)) return;
        try {
            await deleteFixedCost(editingCostoFijo.id);
            onClose();
        } catch (error) {
            console.error("Error deleting fixed cost:", error);
        }
    };

    return (
        <>
            <div
                style={{
                    position: 'fixed', inset: 0, zIndex: 90,
                    background: 'var(--bg-overlay)',
                    backdropFilter: 'blur(4px)',
                }}
                onClick={onClose}
            />
            <div style={{
                position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 91,
                background: 'var(--bg-raised)',
                borderTopLeftRadius: 28, borderTopRightRadius: 28,
                boxShadow: 'var(--shadow-xl)',
                animation: 'sheetIn var(--dur-slow) var(--ease-out)',
                maxHeight: '90dvh',
                display: 'flex', flexDirection: 'column',
            }}>
                {/* Drag handle */}
                <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 12, paddingBottom: 4, flexShrink: 0 }}>
                    <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border-default)' }} />
                </div>

                {/* Header */}
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 20px 16px',
                    borderBottom: '1px solid var(--border-subtle)',
                    flexShrink: 0,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                            width: 36, height: 36, borderRadius: 10,
                            background: 'var(--clay-50)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            <Icon name="event_repeat" size={20} color="var(--clay-600)" />
                        </div>
                        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--fg-1)', letterSpacing: '-0.01em' }}>
                            {editingCostoFijo ? 'Editar Costo Fijo' : 'Nuevo Costo Fijo'}
                        </h2>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {editingCostoFijo && (
                            <button
                                type="button"
                                onClick={handleDelete}
                                title="Eliminar costo fijo"
                                style={{
                                    width: 36, height: 36,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    borderRadius: 10, border: 'none', cursor: 'pointer',
                                    background: 'var(--danger-50)', color: 'var(--danger-700)',
                                }}
                            >
                                <Icon name="delete" size={18} />
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            style={{
                                width: 36, height: 36,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                borderRadius: 10, border: 'none', cursor: 'pointer',
                                background: 'var(--bg-sunken)', color: 'var(--fg-3)',
                            }}
                        >
                            <Icon name="close" size={18} />
                        </button>
                    </div>
                </div>

                {/* Form */}
                <form
                    onSubmit={handleSubmit}
                    style={{ padding: '20px 20px 32px', display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}
                >
                    <Field label="Nombre del costo fijo">
                        <input
                            required
                            type="text"
                            placeholder="ej. Arriendo, Netflix, Internet"
                            value={formData.nombre}
                            onChange={e => set('nombre', e.target.value)}
                            style={INPUT_STYLE}
                        />
                        <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--fg-4)', lineHeight: 1.4 }}>
                            Cada mes buscamos este nombre en tus movimientos reales para marcarlo como pagado — usa el mismo nombre que suele traer el correo del banco (ej. "Netflix").
                        </p>
                    </Field>

                    <Field label="Monto esperado">
                        <div style={{ position: 'relative' }}>
                            <span style={{
                                position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                                fontSize: 15, fontWeight: 700, color: 'var(--fg-3)',
                                fontFamily: 'var(--font-mono)',
                            }}>$</span>
                            <input
                                required
                                type="number"
                                placeholder="0"
                                value={formData.monto}
                                onChange={e => set('monto', e.target.value)}
                                style={{ ...INPUT_STYLE, paddingLeft: 30, fontFamily: 'var(--font-mono)', fontWeight: 600 }}
                            />
                        </div>
                    </Field>

                    <Field label="Día del mes en que vence">
                        <input
                            required
                            type="number"
                            min="1"
                            max="31"
                            placeholder="ej. 5"
                            value={formData.diaVencimiento}
                            onChange={e => set('diaVencimiento', e.target.value)}
                            style={INPUT_STYLE}
                        />
                    </Field>

                    <Field label="Contexto">
                        <select
                            value={formData.contexto}
                            onChange={e => set('contexto', e.target.value)}
                            style={INPUT_STYLE}
                        >
                            <option value="personal">Personal</option>
                            <option value="business">Negocio</option>
                        </select>
                    </Field>

                    <button
                        type="submit"
                        style={{
                            width: '100%', padding: '14px 20px',
                            borderRadius: 'var(--r-xl)', border: 'none',
                            background: 'var(--clay-500)', color: '#fff',
                            fontFamily: 'var(--font-sans)', fontWeight: 800, fontSize: 15,
                            cursor: 'pointer', marginTop: 4,
                            boxShadow: '0 4px 16px -4px rgba(201, 88, 42, 0.45)',
                            transition: 'opacity var(--dur-fast) var(--ease-out)',
                        }}
                    >
                        Guardar Costo Fijo
                    </button>
                </form>
            </div>
        </>
    );
}
