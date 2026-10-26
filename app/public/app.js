const list = document.getElementById('notes');
const form = document.getElementById('note-form');
const input = document.getElementById('note-text');

async function loadInfo() {
  const { instanceId, az } = await (await fetch('/api/info')).json();
  document.getElementById('info').textContent = `Served by ${instanceId} in ${az}`;
}

async function loadNotes() {
  const notes = await (await fetch('/api/notes')).json();
  list.replaceChildren(...notes.map((note) => {
    const li = document.createElement('li');
    li.textContent = note.text;
    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.onclick = async () => {
      await fetch(`/api/notes/${note.id}`, { method: 'DELETE' });
      loadNotes();
    };
    li.append(del);
    return li;
  }));
}

form.onsubmit = async (e) => {
  e.preventDefault();
  await fetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: input.value }),
  });
  input.value = '';
  loadNotes();
};

loadInfo();
loadNotes();
