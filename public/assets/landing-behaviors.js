const langToggle=document.getElementById('langToggle');
if (langToggle) {
  langToggle.addEventListener('click', () => {
    const currentLang = document.documentElement.getAttribute('lang') || 'ar';
    const nextLang = currentLang === 'ar' ? 'en' : 'ar';
    const nextDir = nextLang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.setAttribute('lang', nextLang);
    document.documentElement.setAttribute('dir', nextDir);
    localStorage.setItem('landing-lang', nextLang);
  });
}
const savedLang = localStorage.getItem('landing-lang');
if (savedLang) {
  document.documentElement.setAttribute('lang', savedLang);
  document.documentElement.setAttribute('dir', savedLang === 'ar' ? 'rtl' : 'ltr');
}

const burger=document.getElementById('burger'),nav=document.getElementById('nav');
burger&&burger.addEventListener('click',()=>{const o=nav.classList.toggle('open');burger.setAttribute('aria-expanded',o)});
nav&&nav.querySelectorAll('.nav-links a').forEach(a=>a.addEventListener('click',()=>{nav.classList.remove('open');burger.setAttribute('aria-expanded',false)}));
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    const targetId = this.getAttribute('href');
    if (targetId === '#top') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      const targetElement = document.querySelector(targetId);
      if (targetElement) {
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  });
});
const io=new IntersectionObserver((es)=>{es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{threshold:.14});
document.querySelectorAll('.reveal').forEach(el=>io.observe(el));

// Moved here from a stray, unclosed inline block at the bottom of
// LandingPage.html's <body> (found 2026-09-28): a previous edit that moved
// this file's script to an external src for CSP compliance left the lead
// form's own <script> tag half-removed, so this logic sat as literal text
// in the page body -- never executed, and rendered as visible raw code.
const form=document.getElementById('leadForm');
form&&form.addEventListener('submit',function(ev){ev.preventDefault();let ok=true;
  const set=(i,bad)=>{i.closest('.field').classList.toggle('invalid',bad);if(bad)ok=false;};
  set(form.name,!form.name.value.trim());
  set(form.phone,!/^05\d{8}$/.test(form.phone.value.trim().replace(/\s/g,'')));
  set(form.activity,!form.activity.value);
  if(!ok)return;
  document.getElementById('formFields').style.display='none';
  document.getElementById('success').classList.add('show');
});
form&&form.querySelectorAll('input,select').forEach(i=>i.addEventListener('input',()=>i.closest('.field').classList.remove('invalid')));
