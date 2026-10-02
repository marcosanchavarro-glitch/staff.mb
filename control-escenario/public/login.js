const loginForm = document.querySelector('#login-form');
const accessCode = document.querySelector('#access-code');
const accessError = document.querySelector('#access-error');

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  accessError.hidden = true;
  const button = loginForm.querySelector('button');
  button.disabled = true;
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: accessCode.value })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo ingresar.');
    window.location.assign(result.redirect);
  } catch (error) {
    accessError.textContent = error.message;
    accessError.hidden = false;
    accessCode.select();
  } finally {
    button.disabled = false;
  }
});
