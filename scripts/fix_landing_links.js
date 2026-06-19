import fs from 'fs';

function processFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    let content = fs.readFileSync(filePath, 'utf-8');

    // Change "احجز عرضاً" and "احجز عرضك — بضمان استرجاع" to "ابدأ الآن" and point to /login
    content = content.replace(/href="#pilot"\s*class="btn btn-cta">احجز عرضاً/g, 'href="/login" class="btn btn-cta">ابدأ الآن');
    content = content.replace(/href="#pilot"\s*class="btn btn-cta">احجز عرضك — بضمان استرجاع/g, 'href="/login" class="btn btn-cta">ابدأ الآن');
    content = content.replace(/href="#pilot"\s*class="btn btn-ghost btn-block">تواصل مع المبيعات/g, 'href="/login" class="btn btn-ghost btn-block">ابدأ تجربتك المجانية');

    // Also change intent=trial to just /login to be safe (in case query parsing breaks)
    // Wait, the client's complaint was that "ابدا الان" didn't go to login. I'll add window.location.href onclick bypasses just in case
    content = content.replace(/<a href="\/login\?intent=trial"/g, '<a href="/login" onclick="window.location.href=\'/login\'; return false;"');
    content = content.replace(/<a href="\/login\?intent=subscribe"/g, '<a href="/login" onclick="window.location.href=\'/login\'; return false;"');
    content = content.replace(/<a href="\/login"/g, '<a href="/login" onclick="window.location.href=\'/login\'; return false;"');

    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Processed ${filePath}`);
}

processFile('seen-landing-page.html');
processFile('public/seen-landing.html');
