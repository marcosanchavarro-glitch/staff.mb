# STAFF MB

Sistema en tiempo real para administrar cultos, operar tiempos y mensajes, y mostrar información en una tablet de escenario. Usa Express, Socket.IO y SQLite sin servicios externos de autenticación.

## Acceso y roles

La raíz `/` solicita un código de acceso. Al validarlo, el servidor crea una sesión de dispositivo aleatoria en una cookie `HttpOnly`, `SameSite=Lax` y `Secure` en producción. Los códigos se guardan como hashes `scrypt`; nunca se guardan en texto plano ni en `localStorage`.

- **ADMIN**: configuración completa, operación de la reunión y administración de las tres credenciales globales.
- **MULTIMEDIA**: operación en `/multimedia`; tiempos, secciones, mensajes y avisos, sin modificar cultos ni configuración global.
- **ESCENARIO**: vista de solo lectura en `/pantalla`.

Existe una sola credencial por rol. La clave MULTIMEDIA puede utilizarse a la vez en varios equipos y la clave ESCENARIO en varias tablets o pantallas. Cada dispositivo conserva su propia sesión al recargar.

Los permisos se comprueban en el servidor para cada evento Socket.IO. Ocultar controles en el navegador no se utiliza como medida de seguridad.

## Desarrollo local

Requiere Node.js 22.5 o superior.

```powershell
npm install
$env:ADMIN_ACCESS_CODE="un-codigo-local-seguro"
$env:MULTIMEDIA_ACCESS_CODE="codigo-multimedia"
$env:ESCENARIO_ACCESS_CODE="codigo-escenario"
npm start
```

En Windows también se puede abrir `INICIAR STAFF MB.cmd` cuando las credenciales ya fueron creadas. Las variables iniciales son obligatorias la primera vez y solo se usan para crear una credencial que todavía no exista. Después, los cambios hechos desde ADMIN quedan en SQLite y no son reemplazados al reiniciar.

Vistas:

- Acceso: `http://localhost:3000/`
- Administración: `http://localhost:3000/control`
- Operación multimedia: `http://localhost:3000/multimedia`
- Escenario: `http://IP-DE-LA-PC:3000/pantalla`

## Administrar credenciales

En `/control`, abrir **ACCESOS**. Hay una tarjeta para ADMIN, otra para MULTIMEDIA y otra para ESCENARIO. Cada tarjeta permite escribir y confirmar una nueva clave; el servidor guarda únicamente su hash.

Cambiar una clave impide nuevos ingresos con la clave anterior y conserva las sesiones ya abiertas. ADMIN puede cerrar todas las sesiones MULTIMEDIA o ESCENARIO desde sus respectivas tarjetas. La sección muestra cuántos dispositivos de cada rol están conectados en ese momento.

## Variables de entorno

Consultar `.env.example`:

- `ADMIN_ACCESS_CODE`: credencial ADMIN para la primera ejecución.
- `MULTIMEDIA_ACCESS_CODE`: credencial global MULTIMEDIA para la primera ejecución.
- `ESCENARIO_ACCESS_CODE`: credencial global ESCENARIO para la primera ejecución.
- `DATABASE_PATH`: ubicación del archivo SQLite. El Blueprint gratuito utiliza `/tmp/staff-mb.sqlite`.
- `PUBLIC_URL`: URL HTTPS pública opcional; Render se detecta automáticamente.
- `NODE_ENV=production`: activa cookies `Secure` y confianza en el proxy de Render.
- `PORT`: Render la define automáticamente.

## Render gratuito y SQLite

El archivo `render.yaml` configura un servicio gratuito y el health check. Antes del deploy:

1. Crear el Blueprint desde el repositorio o configurar un Web Service equivalente.
2. Definir `ADMIN_ACCESS_CODE`, `MULTIMEDIA_ACCESS_CODE` y `ESCENARIO_ACCESS_CODE` como secretos para la primera ejecución.
3. Mantener `DATABASE_PATH=/tmp/staff-mb.sqlite`.

El plan gratuito no ofrece disco persistente. Render puede reiniciar SQLite durante un nuevo deploy o al reemplazar la instancia; en ese caso se recupera la configuración inicial y se usan nuevamente las credenciales definidas en las variables de entorno.

## Prueba con varios dispositivos

1. Ingresar como ADMIN desde un celular o computadora.
2. Ingresar con la misma credencial MULTIMEDIA en dos dispositivos y con ESCENARIO en la tablet.
3. Confirmar que ADMIN muestre dos conexiones Multimedia y una Escenario.
4. Abrir un culto desde ADMIN.
5. Iniciar el tiempo desde un Multimedia y sumar un minuto desde el otro.
6. Cambiar sección y enviar un mensaje; verificar la tablet.
7. Intentar abrir `/control` con Multimedia y confirmar **ACCESO NO AUTORIZADO**.
8. Intentar emitir una acción con Escenario y confirmar que el servidor la rechaza.
9. Cambiar la credencial MULTIMEDIA y confirmar que la anterior ya no permite nuevos ingresos.
10. Cerrar todas las sesiones MULTIMEDIA y confirmar que ambos dispositivos vuelvan al acceso.
11. Desconectar y reconectar la tablet; debe recuperar el estado vigente.

El comando de producción y desarrollo es `npm start`.
