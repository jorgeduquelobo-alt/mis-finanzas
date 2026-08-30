import React, { useState, useEffect } from 'react';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useFinance } from '../context/FinanceContext';
import { useAuth } from '../context/AuthContext';
import { Icon, Card, Eyebrow, Segmented } from '../shared/ds/Primitives';
import ConfirmModal from '../shared/components/ConfirmModal';
import { formatCurrency } from '../shared/utils/format';

const INPUT_STYLE = {
    flex: 1, padding: '9px 12px',
    background: 'var(--bg-sunken)',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--r-lg)',
    fontFamily: 'var(--font-sans)', fontSize: 13,
    color: 'var(--fg-1)', outline: 'none',
    boxSizing: 'border-box',
};

const ICON_BTN = (extra = {}) => ({
    width: 32, height: 32,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 8, border: 'none', cursor: 'pointer',
    background: 'transparent', flexShrink: 0,
    transition: 'background var(--dur-fast) var(--ease-out)',
    ...extra,
});

const ConfigSection = ({
    title, icon, listName, inputValue, setInputValue, placeholder,
    appConfig, saving, handleAddItem, handleRemoveItem, handleMoveItemUp, handleEditItem
}) => {
    const [editingIndex, setEditingIndex] = useState(null);
    const [editValue, setEditValue] = useState('');

    const startEdit = (index, value) => { setEditingIndex(index); setEditValue(value); };

    const submitEdit = async (index) => {
        if (!editValue.trim() || editValue === appConfig[listName][index]) {
            setEditingIndex(null);
            return;
        }
        await handleEditItem(listName, index, editValue);
        setEditingIndex(null);
    };

    return (
        <div style={{
            background: 'var(--bg-raised)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--r-2xl)',
            padding: 20,
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <Icon name={icon} size={20} color="var(--clay-500)" />
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--fg-1)' }}>{title}</h3>
            </div>

            {/* Add row */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input
                    type="text"
                    placeholder={placeholder}
                    style={INPUT_STYLE}
                    value={inputValue}
                    onChange={e => setInputValue(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddItem(listName, inputValue, setInputValue)}
                    disabled={saving}
                />
                <button
                    onClick={() => handleAddItem(listName, inputValue, setInputValue)}
                    disabled={saving || !inputValue.trim()}
                    style={{
                        width: 38, height: 38,
                        background: saving || !inputValue.trim() ? 'var(--bg-sunken)' : 'var(--ink-800)',
                        color: saving || !inputValue.trim() ? 'var(--fg-4)' : '#fff',
                        borderRadius: 'var(--r-lg)', border: 'none', cursor: saving || !inputValue.trim() ? 'not-allowed' : 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                    }}
                >
                    <Icon name="add" size={18} />
                </button>
            </div>

            {/* List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {appConfig[listName] && appConfig[listName].length > 0 ? (
                    appConfig[listName].map((item, idx) => (
                        <div key={idx} style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '9px 10px',
                            background: 'var(--bg-sunken)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 'var(--r-lg)',
                        }}>
                            {editingIndex === idx ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, marginRight: 6 }}>
                                    <input
                                        type="text"
                                        style={{ ...INPUT_STYLE, border: '1px solid var(--clay-300)', background: 'var(--bg-raised)', padding: '6px 10px' }}
                                        value={editValue}
                                        onChange={e => setEditValue(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && submitEdit(idx)}
                                        autoFocus
                                        disabled={saving}
                                    />
                                    <button
                                        onClick={() => submitEdit(idx)}
                                        disabled={saving || !editValue.trim()}
                                        style={ICON_BTN({ color: 'var(--olive-600)' })}
                                        onMouseEnter={e => e.currentTarget.style.background = 'var(--olive-50)'}
                                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                    >
                                        <Icon name="check" size={16} />
                                    </button>
                                    <button
                                        onClick={() => setEditingIndex(null)}
                                        style={ICON_BTN({ color: 'var(--fg-3)' })}
                                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-sunken)'}
                                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                    >
                                        <Icon name="close" size={16} />
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-1)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                        {item}
                                        {idx === 0 && listName === 'currencies' && (
                                            <span style={{
                                                fontSize: 10, fontWeight: 700, padding: '2px 6px',
                                                background: 'var(--clay-50)', color: 'var(--clay-600)',
                                                borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.04em',
                                            }}>Principal</span>
                                        )}
                                    </span>
                                    <div style={{ display: 'flex', gap: 2 }}>
                                        <button
                                            onClick={() => startEdit(idx, item)}
                                            disabled={saving}
                                            style={ICON_BTN({ color: 'var(--clay-500)' })}
                                            onMouseEnter={e => e.currentTarget.style.background = 'var(--clay-50)'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                        >
                                            <Icon name="edit" size={15} />
                                        </button>
                                        {idx > 0 && (
                                            <button
                                                onClick={() => handleMoveItemUp(listName, idx)}
                                                disabled={saving}
                                                style={ICON_BTN({ color: 'var(--fg-3)' })}
                                                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-canvas)'}
                                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                            >
                                                <Icon name="arrow_upward" size={15} />
                                            </button>
                                        )}
                                        <button
                                            onClick={() => handleRemoveItem(listName, idx)}
                                            disabled={saving}
                                            style={ICON_BTN({ color: 'var(--danger-700)' })}
                                            onMouseEnter={e => e.currentTarget.style.background = 'var(--danger-50)'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                        >
                                            <Icon name="delete" size={15} />
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    ))
                ) : (
                    <p style={{ fontSize: 12, color: 'var(--fg-4)', fontStyle: 'italic', textAlign: 'center', padding: '12px 0' }}>
                        Sin elementos.
                    </p>
                )}
            </div>
        </div>
    );
};

const ICON_OPTIONS = [
    'category','restaurant','directions_car','shopping_bag','payments','home','bolt',
    'local_gas_station','flight','pets','fitness_center','school','health_and_safety',
    'redeem','savings','credit_card','account_balance','work','storefront','movie',
];

const CategoryConfigSection = ({ appConfig, saving, updateAppConfig }) => {
    const [newCategory, setNewCategory] = useState('');
    const [expandedCategories, setExpandedCategories] = useState({});
    const [newSubcategories, setNewSubcategories] = useState({});
    const [confirmDeleteCat, setConfirmDeleteCat] = useState({ isOpen: false, index: null });
    const [newCategoryIcon, setNewCategoryIcon] = useState('category');
    const [newCategoryType, setNewCategoryType] = useState('debit');
    const [newCategoryContext, setNewCategoryContext] = useState('personal');
    const [editingCatIndex, setEditingCatIndex] = useState(null);
    const [editCatForm, setEditCatForm] = useState({ name: '', icon: 'category', type: 'debit', context: 'personal' });
    const [editingSub, setEditingSub] = useState(null);
    const [editSubValue, setEditSubValue] = useState('');

    const categories = Array.isArray(appConfig.categories) ? appConfig.categories : [];
    const getCatName = cat => typeof cat === 'string' ? cat : cat.name;
    const getSubcats = cat => typeof cat === 'string' ? [] : (cat.subcategories || []);

    const toggleExpand = idx => setExpandedCategories(prev => ({ ...prev, [idx]: !prev[idx] }));

    const handleAddCategory = async () => {
        if (!newCategory.trim()) return;
        const trimmed = newCategory.trim();
        if (categories.some(c => getCatName(c) === trimmed)) return;
        const updatedCategories = [...categories, { name: trimmed, subcategories: [], icon: newCategoryIcon, type: newCategoryType, context: newCategoryContext }];
        await updateAppConfig({ ...appConfig, categories: updatedCategories });
        setNewCategory('');
        setNewCategoryIcon('category');
    };

    const startEditCategory = (index, cat) => {
        setEditingCatIndex(index);
        setEditCatForm({ name: getCatName(cat), icon: cat.icon || 'category', type: cat.type || 'debit', context: cat.context || 'personal' });
    };

    const submitEditCategory = async (index) => {
        const trimmed = editCatForm.name.trim();
        if (!trimmed) { setEditingCatIndex(null); return; }
        const isDuplicate = categories.some((c, i) => i !== index && getCatName(c).toLowerCase() === trimmed.toLowerCase());
        if (isDuplicate) { alert("Ya existe una categoría con este nombre."); return; }
        const updatedCategories = [...categories];
        let category = updatedCategories[index];
        if (typeof category === 'string') { category = { name: trimmed, subcategories: [] }; }
        else { category = { ...category, name: trimmed }; }
        category.icon = editCatForm.icon;
        category.type = editCatForm.type;
        category.context = editCatForm.context;
        updatedCategories[index] = category;
        await updateAppConfig({ ...appConfig, categories: updatedCategories });
        setEditingCatIndex(null);
    };

    const handleDeleteCategory = idx => {
        if (categories.length === 1) { alert("No puedes eliminar la última categoría."); return; }
        setConfirmDeleteCat({ isOpen: true, index: idx });
    };

    const confirmDeleteCategory = async () => {
        if (confirmDeleteCat.index === null) return;
        const updatedCategories = [...categories];
        updatedCategories.splice(confirmDeleteCat.index, 1);
        await updateAppConfig({ ...appConfig, categories: updatedCategories });
        setConfirmDeleteCat({ isOpen: false, index: null });
    };

    const handleMoveCategoryUp = async (index) => {
        if (index === 0) return;
        const updatedCategories = [...categories];
        [updatedCategories[index - 1], updatedCategories[index]] = [updatedCategories[index], updatedCategories[index - 1]];
        await updateAppConfig({ ...appConfig, categories: updatedCategories });
    };

    const startEditSubcategory = (catIndex, subIndex, currentValue) => { setEditingSub({ catIndex, subIndex }); setEditSubValue(currentValue); };

    const submitEditSubcategory = async (catIndex, subIndex) => {
        const trimmed = editSubValue.trim();
        if (!trimmed) { setEditingSub(null); return; }
        const category = categories[catIndex];
        const subcats = getSubcats(category);
        if (subcats.some((s, i) => i !== subIndex && s.toLowerCase() === trimmed.toLowerCase())) { alert("Ya existe una subcategoría con este nombre."); return; }
        const updatedCategories = [...categories];
        const updatedSubcats = [...subcats];
        updatedSubcats[subIndex] = trimmed;
        let updatedCategory = typeof category === 'string' ? { name: category, subcategories: updatedSubcats } : { ...category, subcategories: updatedSubcats };
        updatedCategories[catIndex] = updatedCategory;
        await updateAppConfig({ ...appConfig, categories: updatedCategories });
        setEditingSub(null);
    };

    const handleAddSubcategory = async (catIndex) => {
        const val = newSubcategories[catIndex];
        if (!val?.trim()) return;
        const trimmed = val.trim();
        const updatedCategories = [...categories];
        let category = updatedCategories[catIndex];
        if (typeof category === 'string') category = { name: category, subcategories: [] };
        else category = { ...category };
        const currentSubs = category.subcategories || [];
        if (currentSubs.includes(trimmed)) return;
        category.subcategories = [...currentSubs, trimmed];
        updatedCategories[catIndex] = category;
        await updateAppConfig({ ...appConfig, categories: updatedCategories });
        setNewSubcategories(prev => ({ ...prev, [catIndex]: '' }));
    };

    const handleDeleteSubcategory = async (catIndex, subIndex) => {
        const updatedCategories = [...categories];
        let category = { ...updatedCategories[catIndex] };
        if (typeof category === 'string') return;
        const updatedSubs = [...category.subcategories];
        updatedSubs.splice(subIndex, 1);
        category.subcategories = updatedSubs;
        updatedCategories[catIndex] = category;
        await updateAppConfig({ ...appConfig, categories: updatedCategories });
    };

    const typeBadge = (type) => type === 'credit'
        ? { bg: 'var(--olive-50)', color: 'var(--olive-600)', label: 'Ingreso' }
        : { bg: 'var(--danger-50)', color: 'var(--danger-700)', label: 'Egreso' };

    const ctxBadge = (ctx) => ctx === 'business'
        ? { bg: 'var(--plum-50)', color: 'var(--plum-600)', label: 'Negocio' }
        : { bg: 'var(--clay-50)', color: 'var(--clay-600)', label: 'Personal' };

    const Badge = ({ bg, color, label }) => (
        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 5px', background: bg, color, borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {label}
        </span>
    );

    const iconSelectStyle = {
        height: 38, width: 60,
        background: 'var(--bg-sunken)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--r-lg)',
        color: 'var(--fg-1)',
        cursor: 'pointer',
        appearance: 'none',
        textAlign: 'center',
        flexShrink: 0,
        fontSize: 22,
        outline: 'none',
    };

    return (
        <div style={{
            background: 'var(--bg-raised)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--r-2xl)',
            padding: 20,
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <Icon name="category" size={20} color="var(--clay-500)" />
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--fg-1)' }}>Categorías</h3>
            </div>

            {/* Add form */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                    <select
                        className="material-symbols-outlined"
                        style={iconSelectStyle}
                        value={newCategoryIcon}
                        onChange={e => setNewCategoryIcon(e.target.value)}
                        disabled={saving}
                    >
                        {ICON_OPTIONS.map(ico => <option key={ico} value={ico}>{ico}</option>)}
                    </select>
                    <input
                        type="text"
                        placeholder="Nueva Categoría..."
                        style={INPUT_STYLE}
                        value={newCategory}
                        onChange={e => setNewCategory(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
                        disabled={saving}
                    />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <select
                        style={{ ...INPUT_STYLE, flex: 1 }}
                        value={newCategoryType}
                        onChange={e => setNewCategoryType(e.target.value)}
                        disabled={saving}
                    >
                        <option value="debit">Egreso</option>
                        <option value="credit">Ingreso</option>
                    </select>
                    <select
                        style={{ ...INPUT_STYLE, flex: 1 }}
                        value={newCategoryContext}
                        onChange={e => setNewCategoryContext(e.target.value)}
                        disabled={saving}
                    >
                        <option value="personal">Personal</option>
                        <option value="business">Negocio</option>
                        <option value="both">Ambos</option>
                    </select>
                    <button
                        onClick={handleAddCategory}
                        disabled={saving || !newCategory.trim()}
                        style={{
                            width: 38, height: 38, flexShrink: 0,
                            background: saving || !newCategory.trim() ? 'var(--bg-sunken)' : 'var(--ink-800)',
                            color: saving || !newCategory.trim() ? 'var(--fg-4)' : '#fff',
                            borderRadius: 'var(--r-lg)', border: 'none',
                            cursor: saving || !newCategory.trim() ? 'not-allowed' : 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                    >
                        <Icon name="add" size={18} />
                    </button>
                </div>
            </div>

            {/* Category list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {categories.length > 0 ? categories.map((cat, idx) => {
                    const name = getCatName(cat);
                    const subcats = getSubcats(cat);
                    const isExpanded = expandedCategories[idx];

                    return (
                        <div key={idx} style={{
                            background: 'var(--bg-sunken)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 'var(--r-lg)',
                            overflow: 'hidden',
                        }}>
                            {editingCatIndex === idx ? (
                                <div style={{ padding: 10, background: 'var(--bg-raised)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <select
                                            className="material-symbols-outlined"
                                            style={{ ...iconSelectStyle, fontSize: 18, height: 34 }}
                                            value={editCatForm.icon}
                                            onChange={e => setEditCatForm({ ...editCatForm, icon: e.target.value })}
                                            disabled={saving}
                                        >
                                            {ICON_OPTIONS.map(ico => <option key={ico} value={ico}>{ico}</option>)}
                                        </select>
                                        <input
                                            type="text"
                                            style={{ ...INPUT_STYLE, border: '1px solid var(--clay-300)', background: 'var(--bg-raised)', padding: '6px 10px', fontWeight: 700 }}
                                            value={editCatForm.name}
                                            onChange={e => setEditCatForm({ ...editCatForm, name: e.target.value })}
                                            onKeyDown={e => e.key === 'Enter' && submitEditCategory(idx)}
                                            autoFocus disabled={saving}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                        <select style={{ ...INPUT_STYLE, flex: 1, fontSize: 12, padding: '6px 10px' }} value={editCatForm.type}
                                            onChange={e => setEditCatForm({ ...editCatForm, type: e.target.value })} disabled={saving}>
                                            <option value="debit">Egreso</option>
                                            <option value="credit">Ingreso</option>
                                        </select>
                                        <select style={{ ...INPUT_STYLE, flex: 1, fontSize: 12, padding: '6px 10px' }} value={editCatForm.context}
                                            onChange={e => setEditCatForm({ ...editCatForm, context: e.target.value })} disabled={saving}>
                                            <option value="personal">Personal</option>
                                            <option value="business">Negocio</option>
                                            <option value="both">Ambos</option>
                                        </select>
                                        <button onClick={() => submitEditCategory(idx)} disabled={saving || !editCatForm.name.trim()}
                                            style={ICON_BTN({ color: 'var(--olive-600)' })}
                                            onMouseEnter={e => e.currentTarget.style.background = 'var(--olive-50)'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                            <Icon name="check" size={16} />
                                        </button>
                                        <button onClick={() => setEditingCatIndex(null)}
                                            style={ICON_BTN({ color: 'var(--fg-3)' })}
                                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-sunken)'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                            <Icon name="close" size={16} />
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 10px' }}>
                                        <div
                                            style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, cursor: 'pointer' }}
                                            onClick={() => toggleExpand(idx)}
                                        >
                                            <span style={{
                                                fontSize: 14, color: 'var(--fg-3)',
                                                transform: isExpanded ? 'rotate(90deg)' : 'rotate(0)',
                                                transition: 'transform var(--dur-fast) var(--ease-out)',
                                                display: 'inline-block',
                                                fontFamily: 'Material Symbols Outlined',
                                            }}>chevron_right</span>
                                            <span style={{ fontSize: 11, color: 'var(--fg-4)', fontWeight: 600, minWidth: 14 }}>{subcats.length}</span>
                                            <div style={{
                                                width: 30, height: 30, borderRadius: 8,
                                                background: 'var(--ink-800)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                flexShrink: 0,
                                            }}>
                                                <Icon name={cat.icon || 'category'} size={16} color="#fff" />
                                            </div>
                                            <div>
                                                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-1)' }}>{name}</div>
                                                <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                                                    <Badge {...typeBadge(cat.type)} />
                                                    {cat.context === 'both' ? (
                                                        <><Badge {...ctxBadge('personal')} /><Badge {...ctxBadge('business')} /></>
                                                    ) : <Badge {...ctxBadge(cat.context)} />}
                                                </div>
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', gap: 2 }}>
                                            <button onClick={() => startEditCategory(idx, cat)} disabled={saving}
                                                style={ICON_BTN({ color: 'var(--clay-500)' })}
                                                onMouseEnter={e => e.currentTarget.style.background = 'var(--clay-50)'}
                                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                                <Icon name="edit" size={15} />
                                            </button>
                                            {idx > 0 && (
                                                <button onClick={() => handleMoveCategoryUp(idx)} disabled={saving}
                                                    style={ICON_BTN({ color: 'var(--fg-3)' })}
                                                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-canvas)'}
                                                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                                    <Icon name="arrow_upward" size={15} />
                                                </button>
                                            )}
                                            <button onClick={() => handleDeleteCategory(idx)} disabled={saving}
                                                style={ICON_BTN({ color: 'var(--danger-700)' })}
                                                onMouseEnter={e => e.currentTarget.style.background = 'var(--danger-50)'}
                                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                                <Icon name="delete" size={15} />
                                            </button>
                                        </div>
                                    </div>

                                    {isExpanded && (
                                        <div style={{
                                            background: 'var(--bg-canvas)',
                                            borderTop: '1px solid var(--border-subtle)',
                                            padding: '10px 10px 10px 48px',
                                        }}>
                                            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                                                <input
                                                    type="text"
                                                    placeholder={`Subcategoría de ${name}...`}
                                                    style={{ ...INPUT_STYLE, fontSize: 12, padding: '7px 10px' }}
                                                    value={newSubcategories[idx] || ''}
                                                    onChange={e => setNewSubcategories(prev => ({ ...prev, [idx]: e.target.value }))}
                                                    onKeyDown={e => e.key === 'Enter' && handleAddSubcategory(idx)}
                                                    disabled={saving}
                                                />
                                                <button
                                                    onClick={() => handleAddSubcategory(idx)}
                                                    disabled={saving || !(newSubcategories[idx] || '').trim()}
                                                    style={{
                                                        width: 32, height: 32, flexShrink: 0,
                                                        background: 'var(--ink-800)', color: '#fff',
                                                        borderRadius: 8, border: 'none', cursor: 'pointer',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    }}
                                                >
                                                    <Icon name="add" size={15} />
                                                </button>
                                            </div>

                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                {subcats.length > 0 ? subcats.map((sub, sIdx) => {
                                                    const isEditingThisSub = editingSub?.catIndex === idx && editingSub?.subIndex === sIdx;
                                                    return isEditingThisSub ? (
                                                        <div key={sIdx} style={{
                                                            display: 'flex', alignItems: 'center', gap: 6,
                                                            padding: 6,
                                                            background: 'var(--bg-raised)',
                                                            border: '1px solid var(--clay-200)',
                                                            borderRadius: 8,
                                                        }}>
                                                            <input
                                                                type="text"
                                                                style={{ ...INPUT_STYLE, fontSize: 12, padding: '5px 8px', background: 'var(--bg-sunken)' }}
                                                                value={editSubValue}
                                                                onChange={e => setEditSubValue(e.target.value)}
                                                                onKeyDown={e => e.key === 'Enter' && submitEditSubcategory(idx, sIdx)}
                                                                autoFocus disabled={saving}
                                                            />
                                                            <button onClick={() => submitEditSubcategory(idx, sIdx)} disabled={saving || !editSubValue.trim()}
                                                                style={ICON_BTN({ width: 26, height: 26, color: 'var(--olive-600)' })}
                                                                onMouseEnter={e => e.currentTarget.style.background = 'var(--olive-50)'}
                                                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                                                <Icon name="check" size={14} />
                                                            </button>
                                                            <button onClick={() => setEditingSub(null)}
                                                                style={ICON_BTN({ width: 26, height: 26, color: 'var(--fg-3)' })}
                                                                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-sunken)'}
                                                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                                                <Icon name="close" size={14} />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div key={sIdx} style={{
                                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                            padding: '6px 8px',
                                                            background: 'var(--bg-raised)',
                                                            border: '1px solid var(--border-subtle)',
                                                            borderRadius: 8,
                                                        }}>
                                                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-2)' }}>{sub}</span>
                                                            <div style={{ display: 'flex', gap: 2 }}>
                                                                <button onClick={() => startEditSubcategory(idx, sIdx, sub)} disabled={saving}
                                                                    style={ICON_BTN({ width: 26, height: 26, color: 'var(--clay-500)' })}
                                                                    onMouseEnter={e => e.currentTarget.style.background = 'var(--clay-50)'}
                                                                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                                                    <Icon name="edit" size={13} />
                                                                </button>
                                                                <button onClick={() => handleDeleteSubcategory(idx, sIdx)} disabled={saving}
                                                                    style={ICON_BTN({ width: 26, height: 26, color: 'var(--danger-700)' })}
                                                                    onMouseEnter={e => e.currentTarget.style.background = 'var(--danger-50)'}
                                                                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                                                    <Icon name="close" size={13} />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                }) : (
                                                    <p style={{ fontSize: 11, color: 'var(--fg-4)', fontStyle: 'italic' }}>No hay subcategorías.</p>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    );
                }) : (
                    <p style={{ fontSize: 12, color: 'var(--fg-4)', fontStyle: 'italic', textAlign: 'center', padding: '12px 0' }}>Sin elementos.</p>
                )}
            </div>

            <ConfirmModal
                isOpen={confirmDeleteCat.isOpen}
                onClose={() => setConfirmDeleteCat({ isOpen: false, index: null })}
                onConfirm={confirmDeleteCategory}
                title="Eliminar Categoría"
                message="¿Estás seguro? Se eliminarán también todas sus subcategorías. Esta acción no se puede deshacer."
                confirmText="Eliminar"
                cancelText="Cancelar"
                isDestructive={true}
            />
        </div>
    );
};

const NotificationsSection = ({ push }) => {
    if (!push) return null;
    const { supported, permission, enabled, busy, error, enable, disable } = push;

    let statusText, hint;
    if (!supported) {
        statusText = 'No disponible en este navegador';
        hint = 'En iPhone, añade la app a la pantalla de inicio y ábrela desde ahí para activarlas.';
    } else if (permission === 'denied') {
        statusText = 'Bloqueadas';
        hint = 'Las bloqueaste antes. Habilítalas en los ajustes del navegador para este sitio.';
    } else if (enabled) {
        statusText = 'Activadas en este dispositivo';
        hint = 'Recibirás un aviso cuando entre un movimiento pendiente de revisión.';
    } else {
        statusText = 'Desactivadas';
        hint = 'Recibe un aviso cada vez que entra un movimiento pendiente de revisión.';
    }
    if (error === 'no-vapid') hint = 'Falta configurar la clave VAPID (VITE_FCM_VAPID_KEY) en el build.';
    if (error === 'failed') hint = 'No se pudieron activar. Inténtalo de nuevo.';

    const canToggle = supported && permission !== 'denied';

    return (
        <div style={{
            background: 'var(--bg-raised)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--r-2xl)',
            padding: 20,
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <Icon name="notifications" size={20} color="var(--clay-500)" />
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--fg-1)' }}>Notificaciones</h3>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-1)' }}>{statusText}</div>
                    <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 2 }}>{hint}</div>
                </div>
                <button
                    type="button"
                    onClick={enabled ? disable : enable}
                    disabled={!canToggle || busy}
                    style={{
                        flexShrink: 0, height: 38, padding: '0 16px', borderRadius: 9999, border: 'none',
                        cursor: (!canToggle || busy) ? 'not-allowed' : 'pointer',
                        background: enabled ? 'var(--bg-sunken)' : (!canToggle ? 'var(--bg-sunken)' : 'var(--ink-800)'),
                        color: enabled ? 'var(--fg-2)' : (!canToggle ? 'var(--fg-4)' : '#fff'),
                        fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 12,
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                    }}
                >
                    {busy ? 'Procesando…' : enabled ? 'Desactivar' : 'Activar'}
                </button>
            </div>
        </div>
    );
};

// Saldos por cuenta: el usuario fija el saldo real de una cuenta (el que ve
// en el banco) y desde ese momento la app lo sigue sola sumando/restando los
// movimientos que se registren para esa cuenta (`setSaldoInicial` guarda el
// momento exacto — "anchor" — así los movimientos ya existentes no se
// vuelven a contar). El Fondo de Seguridad Financiera se fija igual, por
// nombre (appConfig.fondo10Cuenta) — Insights lo muestra aparte del Saldo
// Total, no como parte de la suma.
const SaldosInicialesSection = ({ appConfig, accountBalances, setSaldoInicial }) => {
    const [drafts, setDrafts] = useState({});
    const [savingAccount, setSavingAccount] = useState(null);
    const accounts = appConfig.accounts || [];

    const handleSave = async (accountName) => {
        const raw = drafts[accountName];
        if (raw === undefined || raw === '' || isNaN(Number(raw))) return;
        setSavingAccount(accountName);
        try {
            await setSaldoInicial(accountName, Number(raw));
            setDrafts(prev => ({ ...prev, [accountName]: '' }));
        } catch (error) { console.error("Error guardando saldo:", error); }
        finally { setSavingAccount(null); }
    };

    return (
        <div style={{
            background: 'var(--bg-raised)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--r-2xl)',
            padding: 20,
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Icon name="account_balance_wallet" size={20} color="var(--clay-500)" />
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--fg-1)' }}>Saldos</h3>
            </div>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--fg-3)' }}>
                Fija el saldo real de una cuenta (el que ves en el banco) y desde ahí la app lo actualiza sola con cada movimiento nuevo que registres en esa cuenta. Se refleja en el Saldo Total de Radiografía.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {accounts.length === 0 ? (
                    <p style={{ fontSize: 12, color: 'var(--fg-4)', fontStyle: 'italic', textAlign: 'center', padding: '12px 0' }}>
                        Sin cuentas. Agrega una en Tarjetas y Cuentas primero.
                    </p>
                ) : accounts.map(accountName => {
                    const fijado = appConfig.saldosIniciales?.[accountName];
                    const computed = accountBalances?.[accountName]?.balance;
                    const saving = savingAccount === accountName;
                    const draft = drafts[accountName] ?? '';

                    return (
                        <div key={accountName} style={{
                            padding: '10px 12px',
                            background: 'var(--bg-sunken)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 'var(--r-lg)',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 8 }}>
                                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-1)' }}>{accountName}</span>
                                {typeof computed === 'number' && (
                                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--fg-2)', whiteSpace: 'nowrap' }}>
                                        {formatCurrency(computed, 'COP')}
                                    </span>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <input
                                    type="number"
                                    placeholder={fijado ? String(fijado.monto) : 'Saldo actual…'}
                                    style={{ ...INPUT_STYLE, fontSize: 12, padding: '7px 10px' }}
                                    value={draft}
                                    onChange={e => setDrafts(prev => ({ ...prev, [accountName]: e.target.value }))}
                                    onKeyDown={e => e.key === 'Enter' && handleSave(accountName)}
                                    disabled={saving}
                                />
                                <button
                                    onClick={() => handleSave(accountName)}
                                    disabled={saving || draft === '' || isNaN(Number(draft))}
                                    style={{
                                        width: 38, height: 34, flexShrink: 0,
                                        background: (saving || draft === '' || isNaN(Number(draft))) ? 'var(--bg-sunken)' : 'var(--ink-800)',
                                        color: (saving || draft === '' || isNaN(Number(draft))) ? 'var(--fg-4)' : '#fff',
                                        borderRadius: 'var(--r-lg)', border: 'none',
                                        cursor: (saving || draft === '' || isNaN(Number(draft))) ? 'not-allowed' : 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}
                                >
                                    <Icon name="check" size={16} />
                                </button>
                            </div>
                            {fijado && (
                                <p style={{ margin: '6px 0 0', fontSize: 10, color: 'var(--fg-4)' }}>
                                    Fijado en {formatCurrency(fijado.monto, 'COP')} el {new Date(fijado.anchor).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </p>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// Config de instancia (etiqueta de Gmail del sync, tasa USD→COP) guardada en
// finance_settings/default junto a los catálogos, vía el mismo updateAppConfig.
const InstanceConfigSection = ({ appConfig, updateAppConfig }) => {
    const [gmailLabel, setGmailLabel] = useState(appConfig.gmailLabel ?? '');
    const [exchangeRate, setExchangeRate] = useState(appConfig.exchangeRate != null ? String(appConfig.exchangeRate) : '');
    const [saving, setSaving] = useState(false);

    // Resincroniza los inputs cuando el config termina de cargar de Firestore.
    useEffect(() => { setGmailLabel(appConfig.gmailLabel ?? ''); }, [appConfig.gmailLabel]);
    useEffect(() => { setExchangeRate(appConfig.exchangeRate != null ? String(appConfig.exchangeRate) : ''); }, [appConfig.exchangeRate]);

    const handleSave = async () => {
        setSaving(true);
        try {
            const rate = Number(exchangeRate);
            await updateAppConfig({
                ...appConfig,
                gmailLabel: gmailLabel.trim(),
                exchangeRate: rate > 0 ? rate : null,
            });
        } catch (error) { console.error("Error guardando config de instancia:", error); }
        finally { setSaving(false); }
    };

    const FIELD_LABEL = {
        fontSize: 11, fontWeight: 700, color: 'var(--fg-3)',
        letterSpacing: '0.06em', textTransform: 'uppercase',
    };
    const HINT = { fontSize: 11, color: 'var(--fg-4)', margin: '4px 0 0' };

    return (
        <div style={{
            background: 'var(--bg-raised)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--r-2xl)',
            padding: 20,
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <Icon name="tune" size={20} color="var(--clay-500)" />
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--fg-1)' }}>Sincronización y moneda</h3>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={FIELD_LABEL}>Etiqueta de Gmail del sync</span>
                    <input
                        type="text"
                        placeholder="Bancos/PendingBot"
                        style={INPUT_STYLE}
                        value={gmailLabel}
                        onChange={e => setGmailLabel(e.target.value)}
                        disabled={saving}
                    />
                    <p style={HINT}>Etiqueta que el pipeline busca en Gmail. Vacío = usar la de por defecto (Bancos/PendingBot).</p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={FIELD_LABEL}>Tasa de cambio USD → COP</span>
                    <input
                        type="number"
                        placeholder="4100"
                        style={INPUT_STYLE}
                        value={exchangeRate}
                        onChange={e => setExchangeRate(e.target.value)}
                        disabled={saving}
                    />
                    <p style={HINT}>Usada en Radiografía para convertir transacciones en USD. Vacío = 4100.</p>
                </div>
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    style={{
                        alignSelf: 'flex-start', height: 38, padding: '0 18px', borderRadius: 'var(--r-lg)', border: 'none',
                        background: 'var(--ink-800)', color: '#fff',
                        fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 12,
                        cursor: saving ? 'wait' : 'pointer',
                        opacity: saving ? 0.6 : 1,
                    }}
                >
                    {saving ? 'Guardando…' : 'Guardar'}
                </button>
            </div>
        </div>
    );
};

// Whitelist de acceso: finance_settings/users.allowedEmails. Las rules de
// Firestore ya permiten update solo a usuarios que están en la lista.
const WhitelistSection = () => {
    const { currentUser } = useAuth();
    const [emails, setEmails] = useState(null); // null = cargando
    const [newEmail, setNewEmail] = useState('');
    const [busy, setBusy] = useState(false);
    const [emailToRemove, setEmailToRemove] = useState(null);

    useEffect(() => {
        const ref = doc(db, 'finance_settings', 'users');
        return onSnapshot(ref,
            snap => setEmails(snap.exists() ? (snap.data().allowedEmails || []) : []),
            error => { console.error("Error leyendo usuarios autorizados:", error); setEmails([]); },
        );
    }, []);

    const save = async (list) => {
        setBusy(true);
        try {
            await updateDoc(doc(db, 'finance_settings', 'users'), { allowedEmails: list });
        } catch (error) { console.error("Error actualizando usuarios autorizados:", error); }
        finally { setBusy(false); }
    };

    const handleAdd = async () => {
        const email = newEmail.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { alert("Ingresa un correo válido."); return; }
        if (emails.some(e => e.toLowerCase() === email)) { setNewEmail(''); return; }
        await save([...emails, email]);
        setNewEmail('');
    };

    const isSelf = (email) => email.toLowerCase() === (currentUser?.email || '').toLowerCase();

    return (
        <div style={{
            background: 'var(--bg-raised)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--r-2xl)',
            padding: 20,
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Icon name="group" size={20} color="var(--clay-500)" />
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--fg-1)' }}>Usuarios autorizados</h3>
            </div>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--fg-3)' }}>
                Cuentas de Google que pueden entrar a esta instancia.
            </p>

            {/* Add row */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input
                    type="email"
                    placeholder="correo@gmail.com"
                    style={INPUT_STYLE}
                    value={newEmail}
                    onChange={e => setNewEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAdd()}
                    disabled={busy || emails === null}
                />
                <button
                    onClick={handleAdd}
                    disabled={busy || emails === null || !newEmail.trim()}
                    style={{
                        width: 38, height: 38,
                        background: busy || !newEmail.trim() ? 'var(--bg-sunken)' : 'var(--ink-800)',
                        color: busy || !newEmail.trim() ? 'var(--fg-4)' : '#fff',
                        borderRadius: 'var(--r-lg)', border: 'none', cursor: busy || !newEmail.trim() ? 'not-allowed' : 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                    }}
                >
                    <Icon name="add" size={18} />
                </button>
            </div>

            {/* List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {emails === null ? (
                    <p style={{ fontSize: 12, color: 'var(--fg-4)', margin: 0 }}>Cargando…</p>
                ) : emails.map((email) => (
                    <div key={email} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '9px 10px',
                        background: 'var(--bg-sunken)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--r-lg)',
                    }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-1)', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</span>
                            {isSelf(email) && (
                                <span style={{
                                    fontSize: 10, fontWeight: 700, padding: '2px 6px',
                                    background: 'var(--clay-50)', color: 'var(--clay-600)',
                                    borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.04em',
                                }}>Tú</span>
                            )}
                        </span>
                        {/* Sin auto-eliminación: quedaría fuera de su propia instancia. */}
                        {!isSelf(email) && (
                            <button
                                onClick={() => setEmailToRemove(email)}
                                disabled={busy}
                                style={ICON_BTN({ color: 'var(--danger-700)' })}
                                onMouseEnter={e => e.currentTarget.style.background = 'var(--danger-50)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >
                                <Icon name="delete" size={16} />
                            </button>
                        )}
                    </div>
                ))}
            </div>

            <ConfirmModal
                isOpen={emailToRemove !== null}
                onClose={() => setEmailToRemove(null)}
                onConfirm={async () => {
                    await save(emails.filter(e => e !== emailToRemove));
                    setEmailToRemove(null);
                }}
                title="Quitar acceso"
                message={`${emailToRemove} ya no podrá entrar a la app.`}
                confirmText="Quitar"
                isDestructive
            />
        </div>
    );
};

export default function Settings({ push }) {
    const { appConfig, updateAppConfig, accountBalances, setSaldoInicial } = useFinance();
    const { currentUser, logout } = useAuth();
    const [saving, setSaving] = useState(false);
    const [newCurrency, setNewCurrency] = useState('');
    const [newAccount, setNewAccount] = useState('');
    const [activeTab, setActiveTab] = useState('account');

    const displayName = currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Usuario';
    const email = currentUser?.email || '';
    const initial = displayName.charAt(0).toUpperCase();

    const handleAddItem = async (listName, value, setter) => {
        if (!value.trim()) return;
        const trimmed = value.trim();
        if (appConfig[listName].includes(trimmed)) return;
        setSaving(true);
        try {
            await updateAppConfig({ ...appConfig, [listName]: [...appConfig[listName], trimmed] });
            setter('');
        } catch (error) { console.error("Error adding item:", error); }
        finally { setSaving(false); }
    };

    const handleRemoveItem = async (listName, index) => {
        if (appConfig[listName].length === 1) { alert("No puedes eliminar el último elemento. Debes tener al menos uno."); return; }
        setSaving(true);
        try {
            const updatedList = [...appConfig[listName]];
            updatedList.splice(index, 1);
            await updateAppConfig({ ...appConfig, [listName]: updatedList });
        } catch (error) { console.error("Error removing item:", error); }
        finally { setSaving(false); }
    };

    const handleMoveItemUp = async (listName, index) => {
        if (index === 0) return;
        setSaving(true);
        try {
            const updatedList = [...appConfig[listName]];
            [updatedList[index - 1], updatedList[index]] = [updatedList[index], updatedList[index - 1]];
            await updateAppConfig({ ...appConfig, [listName]: updatedList });
        } catch (error) { console.error("Error moving item:", error); }
        finally { setSaving(false); }
    };

    const handleEditItem = async (listName, index, newValue) => {
        const trimmed = newValue.trim();
        if (!trimmed) return;
        if (appConfig[listName].some((item, i) => i !== index && item.toLowerCase() === trimmed.toLowerCase())) { alert("Ya existe un elemento con este nombre."); return; }
        setSaving(true);
        try {
            const updatedList = [...appConfig[listName]];
            updatedList[index] = trimmed;
            await updateAppConfig({ ...appConfig, [listName]: updatedList });
        } catch (error) { console.error("Error editing item:", error); }
        finally { setSaving(false); }
    };

    const sharedSectionProps = { appConfig, saving, handleAddItem, handleRemoveItem, handleMoveItemUp, handleEditItem };

    return (
        <div className="animate-fade-up" style={{ maxWidth: 1000, margin: '0 auto', padding: '16px 16px 32px', display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Page title */}
            <div>
                <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: 'var(--fg-1)', letterSpacing: '-0.02em' }}>Yo</h1>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--fg-3)' }}>Cuenta, catálogos y preferencias.</p>
            </div>

            {/* Tab selector */}
            <Segmented
                value={activeTab}
                onChange={setActiveTab}
                options={[
                    { value: 'account',  label: 'Cuenta' },
                    { value: 'finance',  label: 'Finanzas' },
                ]}
            />

            {/* CUENTA TAB */}
            {activeTab === 'account' && <>

            {/* Profile hero */}
            <Card padding={18} style={{ borderRadius: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    {currentUser?.photoURL ? (
                        <img
                            src={currentUser.photoURL} alt=""
                            style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--bg-raised)', boxShadow: '0 0 0 1px var(--border-default)' }}
                        />
                    ) : (
                        <div style={{
                            width: 56, height: 56, borderRadius: '50%',
                            background: 'linear-gradient(135deg, var(--clay-400), var(--clay-600))',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 26,
                            color: '#fff', fontWeight: 500,
                            border: '2px solid var(--bg-raised)', boxShadow: '0 0 0 1px var(--border-default)',
                        }}>{initial}</div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--fg-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {displayName}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {email}
                        </div>
                    </div>
                </div>
            </Card>

            </>}
            {/* FINANZAS TAB */}
            {activeTab === 'finance' && <>
            {/* Catalogs */}
            <Eyebrow style={{ paddingLeft: 4, marginTop: 4 }}>Catálogos</Eyebrow>
            <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14,
            }}>
                <ConfigSection
                    {...sharedSectionProps}
                    title="Monedas"
                    icon="payments"
                    listName="currencies"
                    inputValue={newCurrency}
                    setInputValue={setNewCurrency}
                    placeholder="Ej. GBP"
                />
                <ConfigSection
                    {...sharedSectionProps}
                    title="Tarjetas y Cuentas"
                    icon="credit_card"
                    listName="accounts"
                    inputValue={newAccount}
                    setInputValue={setNewAccount}
                    placeholder="Ej. Santander Débito"
                />
                <CategoryConfigSection
                    appConfig={appConfig}
                    saving={saving}
                    updateAppConfig={updateAppConfig}
                />
            </div>

            {/* Saldos por cuenta — alimenta el Saldo Total de Radiografía */}
            <Eyebrow style={{ paddingLeft: 4, marginTop: 4 }}>Saldos</Eyebrow>
            <SaldosInicialesSection appConfig={appConfig} accountBalances={accountBalances} setSaldoInicial={setSaldoInicial} />

            {/* Instance config */}
            <Eyebrow style={{ paddingLeft: 4, marginTop: 4 }}>Instancia</Eyebrow>
            <InstanceConfigSection appConfig={appConfig} updateAppConfig={updateAppConfig} />

            </>}
            {/* CUENTA TAB — part 2: whitelist + notifications + logout */}
            {activeTab === 'account' && <>

            {/* Access whitelist */}
            <Eyebrow style={{ paddingLeft: 4, marginTop: 4 }}>Acceso</Eyebrow>
            <WhitelistSection />

            {/* Notifications */}
            <Eyebrow style={{ paddingLeft: 4, marginTop: 4 }}>Avisos</Eyebrow>
            <NotificationsSection push={push} />

            {/* Logout */}
            <button
                type="button"
                onClick={logout}
                style={{
                    marginTop: 4, padding: '14px 0', background: 'transparent', border: 'none', cursor: 'pointer',
                    color: 'var(--danger-700)', fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-sans)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
            >
                <Icon name="logout" size={18} />
                Cerrar sesión
            </button>
            </>}

        </div>
    );
}
