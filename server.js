import express from 'express';
const app = express();
app.get('/', (_req, res) => res.send('DayZ Crates bot is alive'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Health server listening on ${PORT}`));
