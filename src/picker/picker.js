const list = document.getElementById('sources');
window.capturePicker.onSources(sources => {
  list.replaceChildren();
  for (const source of sources) {
    const button = document.createElement('button'); button.className = 'source';
    const image = document.createElement('img'); image.src = source.thumbnail; image.alt = '';
    const label = document.createElement('span'); label.textContent = source.name;
    button.append(image, label);
    button.addEventListener('click', () => window.capturePicker.choose(source.id));
    list.append(button);
  }
  list.querySelector('button')?.focus();
});
document.getElementById('cancel').addEventListener('click', () => window.capturePicker.choose(null));
document.addEventListener('keydown', event => { if (event.key === 'Escape') void window.capturePicker.choose(null); });
