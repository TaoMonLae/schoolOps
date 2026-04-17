/**
 * Build an UPDATE ... SET clause that skips undefined fields (keep existing
 * value) but preserves explicit null (clear the value). Fixes the bug where
 * COALESCE(?, column) silently kept old values when null was passed.
 *
 * Usage:
 *   const { sql, values } = buildPatchUpdate(
 *     'students',
 *     { name, level, notes },   // undefined = not sent; null = clear it
 *     'id = ?',
 *     [studentId],
 *   );
 *   if (sql) db.prepare(sql).run(...values);
 */
function buildPatchUpdate(table, fields, whereClause, whereParams) {
  const cols = [];
  const values = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    cols.push(`${key} = ?`);
    values.push(value);
  }
  if (!cols.length) return { sql: null, values: [] };
  return {
    sql: `UPDATE ${table} SET ${cols.join(', ')} WHERE ${whereClause}`,
    values: [...values, ...whereParams],
  };
}

module.exports = { buildPatchUpdate };
