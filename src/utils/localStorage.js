export function loadData(key, fallbackData = []) {
  try {
    const savedData = localStorage.getItem(key);

    if (!savedData) {
      return fallbackData;
    }

    const parsedData = JSON.parse(savedData);

    return Array.isArray(parsedData)
      ? parsedData
      : fallbackData;
  } catch (error) {
    console.error(
      `Gagal membaca data ${key}:`,
      error
    );

    return fallbackData;
  }
}

export function saveData(key, data) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify(data)
    );
  } catch (error) {
    console.error(
      `Gagal menyimpan data ${key}:`,
      error
    );
  }
}