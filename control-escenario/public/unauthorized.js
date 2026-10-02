document.querySelector('#logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.assign('/');
});
