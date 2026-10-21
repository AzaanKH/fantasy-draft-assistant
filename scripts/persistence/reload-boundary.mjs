export async function readReloadBoundary({ read, attach, recordReplacement }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const rows = await read();
    const replacements = rows.filter(row => row.kind === 'replaced');
    if (replacements.length === 0) return rows.map(row => row.snapshot);
    recordReplacement(replacements);
    await attach();
  }
  throw new Error('Documents kept changing at the explicit reload boundary');
}
