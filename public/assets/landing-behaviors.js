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
