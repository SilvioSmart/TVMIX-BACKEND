const vowels = new Set(["A", "E", "I", "O", "U"]);

export function createProgramId(name: string): string {
  const letters = name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  const consonants = [...letters].filter((letter) => !vowels.has(letter));
  return consonants.slice(0, 5).join("").padEnd(5, "X");
}

export function createSeasonId(programId: string, seasonNumber: number): string {
  if (!/^[A-Z]{5}$/.test(programId)) {
    throw new Error("ID programma non valido");
  }
  if (!Number.isInteger(seasonNumber) || seasonNumber < 1 || seasonNumber > 99) {
    throw new Error("Numero stagione non valido");
  }
  return `${programId[0]}${programId[2]}${programId[4]}S${String(seasonNumber).padStart(2, "0")}`;
}
