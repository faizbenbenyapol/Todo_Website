(() => {
  const THEMES = ['light', 'dark', 'sakura', 'mint', 'sky', 'lavender', 'peach', 'sand'];
  try {
    const saved = localStorage.getItem('eisenhower-theme') || 'system';
    let resolved;
    if (saved === 'system') {
      resolved = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } else {
      resolved = THEMES.includes(saved) ? saved : 'light';
    }
    document.documentElement.dataset.theme = resolved;
  } catch {
    document.documentElement.dataset.theme = 'light';
  }
})();
