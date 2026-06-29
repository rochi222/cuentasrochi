# Cuentas de casa 🏠 (versión compartida con Supabase)

App para dividir las cuentas del mes entre vos y tu hermana, con cálculo de quién
le paga a quién y gráfico de gasto por mes. Los datos se guardan en una **base
online (Supabase)**, así las dos ven y editan lo mismo desde cualquier celular.

---

## Paso 1 · Crear la base en Supabase (5 min)

1. Entrá a **supabase.com** y creá una cuenta gratis.
2. Tocá **New project**. Ponele un nombre (ej. `cuentas-casa`), elegí una
   contraseña para la base y la región más cercana. Esperá ~1 min a que se cree.
3. En el menú de la izquierda andá a **SQL Editor -> New query**, pegá todo el
   contenido del archivo `supabase_setup.sql` y tocá **Run**. Eso crea la tabla y
   los permisos. (Como sabés SQL, vas a ver que es una sola tabla clave/valor.)
4. Andá a **Settings (engranaje) -> API** y copiá dos cosas:
   - **Project URL** (algo como `https://abcd1234.supabase.co`)
   - **anon public** key (una clave larga)

## Paso 2 · Conectar la app

1. Copiá el archivo `.env.example` y renombralo a `.env`.
2. Pegá ahí tus dos valores:
   ```
   VITE_SUPABASE_URL=https://abcd1234.supabase.co
   VITE_SUPABASE_ANON_KEY=la_clave_anon_public
   ```

## Paso 3 · Probarla en tu compu

Necesitás Node.js (https://nodejs.org), versión LTS.

```bash
npm install
npm run dev
```

Abrís http://localhost:5173. Si ves la pantalla "Falta conectar la base", es que
el `.env` no quedó bien cargado.

## Paso 4 · Subirla gratis a internet (Vercel)

1. Subí la carpeta a un repo de GitHub (el `.env` NO se sube, queda ignorado).
2. En vercel.com -> Add New -> Project -> elegí el repo.
3. IMPORTANTE: en "Environment Variables" cargá las mismas dos:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy. Te da una URL tipo `cuentas-casa.vercel.app`.
5. Pasale la URL a tu hermana. Las dos abren el mismo link y ven lo mismo. Desde
   el celu: Compartir -> Agregar a inicio y queda como una app.

---

## Cómo se actualiza entre las dos

- Cuando cargás algo, se guarda en la base al toque.
- La otra persona ve los cambios al **volver a la pantalla** (o tocando el botón
  **⟳** arriba a la derecha). No hace falta recargar la página entera.

## Cosas para saber

- La `anon key` viaja en la app, así que cualquiera con tu URL podría ver/editar
  las cuentas. Para un par de boletas entre hermanas está perfecto; si querés
  privacidad real, se le agrega login (Supabase Auth). Pedímelo y lo armamos.
- Si dos editan el mismo gasto al mismo segundo, gana el último en guardar.

## Cómo está hecho

- React + Vite. La lógica y el estilo están en `src/App.jsx`.
- La conexión a la base está en `src/storageClient.js`.
- Para cambiar colores: variables al final de `App.jsx` (`--paper`, `--green`,
  `--signal`...) y la lista `PERSON_COLORS`.
