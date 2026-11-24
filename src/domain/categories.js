export const CATEGORIES = Object.freeze(['salidas', 'comida', 'transporte', 'emergencias', 'lujo']);
export const UNCATEGORIZED = 'sin_categoria';

export const CATEGORY_LABELS = Object.freeze({
  salidas: 'Salidas',
  comida: 'Comida',
  transporte: 'Transporte',
  emergencias: 'Emergencias',
  lujo: 'Lujo',
  sin_categoria: 'Sin categoría'
});

export const isCategory = (value) => CATEGORIES.includes(value);

export const categoryLabel = (value) => CATEGORY_LABELS[value ?? UNCATEGORIZED] ?? value;
