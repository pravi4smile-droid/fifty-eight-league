// /api/login — POST { username, password } -> { ok, token }
// Credentials come from AUTH_USER / AUTH_PASS environment variables (no defaults).
export default function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ ok: false });

    const user = process.env.AUTH_USER;
    const pass = process.env.AUTH_PASS;
    if (!user || !pass) {
        return res.status(500).json({ ok: false, error: 'AUTH_USER / AUTH_PASS not configured' });
    }

    const { username, password } = req.body || {};
    if (username === user && password === pass) {
        const token = Buffer.from(user + ':' + pass).toString('base64');
        return res.status(200).json({ ok: true, token });
    }
    res.status(401).json({ ok: false, error: 'Wrong username or password' });
}
