/**
 * Items (organizations, departments, products) can carry their own
 * information as groups of "field name: value" rows, e.g.
 *
 *   [{ title: 'Company details', fields: [{ label: 'Business ID', value: '1234567-8' }] }]
 *
 * stored on the item as `details`.
 */

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * Tidy the editor's state for saving: trim text, drop rows without a field
 * name and value, and drop groups that end up without title and rows.
 */
export function cleanDetails(groups) {
  return (Array.isArray(groups) ? groups : [])
    .map((group) => ({
      title: text(group?.title),
      fields: (Array.isArray(group?.fields) ? group.fields : [])
        .map((field) => ({ label: text(field?.label), value: text(field?.value) }))
        .filter((field) => field.label || field.value),
    }))
    .filter((group) => group.title || group.fields.length);
}

/** Editable copy of an item's details (the editor must not change the item). */
export function editableDetails(groups) {
  return cleanDetails(groups).map((group) => ({
    title: group.title,
    fields: group.fields.map((field) => ({ ...field })),
  }));
}
