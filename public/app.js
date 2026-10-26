const form = document.querySelector('#read-form');
const input = document.querySelector('#url');
const result = document.querySelector('#result');
const button = form.querySelector('button[type="submit"]');
const filterName = document.querySelector('#filter-name');

function showMessage(message, error = false) {
  result.replaceChildren();
  const placeholder = document.createElement('div');
  placeholder.className = 'placeholder';
  const text = document.createElement('p');
  text.className = error ? 'error' : '';
  text.textContent = message;
  placeholder.append(text);
  result.append(placeholder);
}

fetch('/api/config').then((response) => response.json()).then(({ filter }) => {
  filterName.textContent = `Adult-content filter: ${filter.name}`;
}).catch(() => { filterName.textContent = 'Content filter status unavailable'; });

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  button.disabled = true;
  button.querySelector('span').textContent = 'Fetching…';
  showMessage('Fetching page…');
  try {
    const response = await fetch('/api/read', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: input.value }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The page could not be loaded.');
    result.replaceChildren();
    const meta = document.createElement('div');
    meta.className = 'page-meta';
    const address = document.createElement('span');
    address.textContent = data.url;
    const mode = document.createElement('span');
    mode.textContent = 'TEXT VIEW';
    meta.append(address, mode);
    const title = document.createElement('h2');
    title.textContent = data.title;
    const text = document.createElement('p');
    text.className = 'page-text';
    text.textContent = data.text || 'This page did not contain readable text.';
    result.append(meta, title, text);
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    button.disabled = false;
    button.querySelector('span').textContent = 'Read page';
  }
});