// ============================================
// HomePlate — USER APP (redesigned, premium)
// Bottom-nav: Home / Orders / Cart / Profile
// Multi-address + Live location (Leaflet + Nominatim, free)
// ============================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc,
  query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getDatabase, ref, set, onValue
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// ---------- CONFIG ----------
const firebaseConfig = {
  apiKey: "AIzaSyDO8rLj1rvHZq6f2luS14E36wamQVq6vnU",
  authDomain: "love-4db65.firebaseapp.com",
  databaseURL: "https://love-4db65-default-rtdb.firebaseio.com",
  projectId: "love-4db65",
  storageBucket: "love-4db65.firebasestorage.app",
  messagingSenderId: "314625864463",
  appId: "1:314625864463:web:d8c03e4f646d006b3c047a",
  measurementId: "G-PHH8KV3B81"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const rtdb = getDatabase(app);
const googleProvider = new GoogleAuthProvider();

// ============================================
// UTILS
// ============================================
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const escapeHtml = (str='') => String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => `₹${Number(n||0).toFixed(0)}`;
const FALLBACK_DISH = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&q=80';
const FALLBACK_CHEF = 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=600&q=80';
const FALLBACK_AVATAR = 'https://images.unsplash.com/photo-1595475207225-428b62bda831?w=200&q=80';

function toast(message, type='success', duration=2500){
  let c = $('.toast-container');
  if(!c){ c = document.createElement('div'); c.className = 'toast-container'; document.body.appendChild(c); }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success:'fa-circle-check', error:'fa-circle-exclamation', warning:'fa-triangle-exclamation' };
  el.innerHTML = `<i class="fa-solid ${icons[type]||icons.success}"></i><span>${escapeHtml(message)}</span>`;
  c.appendChild(el);
  setTimeout(() => { el.classList.add('hide'); setTimeout(()=>el.remove(),300); }, duration);
}

function formatDate(ts){
  if(!ts) return '';
  const d = ts.toDate ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts));
  return d.toLocaleDateString('en-IN',{ day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'});
}

const loaderHTML = (label='Warming up the kitchen…') => `
  <div class="full-loader"><div class="cooking-loader">
    <div class="steam"></div><div class="steam"></div><div class="steam"></div>
    <div class="pan"></div><div class="label">${label}</div>
  </div></div>`;

// Router
const navigate = p => { window.location.hash = p; };
const parseRoute = () => {
  const raw = (window.location.hash || '#/').slice(1);
  const [path, q=''] = raw.split('?');
  return { seg: path.split('/').filter(Boolean), qs: new URLSearchParams(q) };
};

// ============================================
// CART / ADDRESSES (localStorage)
// ============================================
const CART_KEY = 'hp_cart';
const ADDR_KEY = 'hp_addresses';
const SEL_ADDR_KEY = 'hp_selected_addr';

const getCart = () => { try { return JSON.parse(localStorage.getItem(CART_KEY)||'[]'); } catch { return []; } };
const saveCart = c => { localStorage.setItem(CART_KEY, JSON.stringify(c)); updateBadges(); window.dispatchEvent(new Event('cart-updated')); };
const clearCart = () => { localStorage.removeItem(CART_KEY); updateBadges(); };
const cartTotal = () => getCart().reduce((s,i)=>s+i.price*i.qty,0);
const cartCount = () => getCart().reduce((s,i)=>s+i.qty,0);

function addToCart(dish){
  const cart = getCart();
  const ex = cart.find(i=>i.id===dish.id);
  if(ex) ex.qty += 1;
  else cart.push({ id:dish.id, name:dish.name, price:dish.price, image:dish.image, chefName:dish.chefName, chefId:dish.chefId, qty:1 });
  saveCart(cart);
}
function updateQty(id, delta){
  const cart = getCart();
  const item = cart.find(i=>i.id===id);
  if(!item) return;
  item.qty += delta;
  if(item.qty <= 0) saveCart(cart.filter(i=>i.id!==id));
  else saveCart(cart);
}
const removeItem = id => saveCart(getCart().filter(i=>i.id!==id));

// Addresses
const getAddresses = () => { try { return JSON.parse(localStorage.getItem(ADDR_KEY)||'[]'); } catch { return []; } };
const saveAddresses = a => localStorage.setItem(ADDR_KEY, JSON.stringify(a));
const getSelectedAddr = () => {
  const id = localStorage.getItem(SEL_ADDR_KEY);
  const list = getAddresses();
  return list.find(a=>a.id===id) || list[0] || null;
};
const setSelectedAddr = id => { localStorage.setItem(SEL_ADDR_KEY, id); window.dispatchEvent(new Event('addr-changed')); };

function updateBadges(){
  $$('.cart-badge').forEach(el => {
    const c = cartCount();
    el.textContent = c;
    el.style.display = c>0 ? 'flex' : 'none';
  });
}

// ============================================
// AUTH
// ============================================
let _user = null;
const requireAuth = () => new Promise(resolve => {
  const un = onAuthStateChanged(auth, u => { un(); if(!u){ toast('Please login to continue','warning'); setTimeout(()=>navigate('/login'),700); resolve(null); } else resolve(u); });
});

// ============================================
// TOP HEADER (location + search)
// ============================================
function renderHeader(){
  const h = $('#top-header');
  if(!h) return;
  const sel = getSelectedAddr();
  const locTag = sel ? sel.tag : 'Set location';
  const locFull = sel ? sel.fullAddress : 'Tap to add your delivery address';
  const initial = _user ? (_user.displayName || _user.email || 'U')[0].toUpperCase() : '';

  h.innerHTML = `
    <div class="header-inner">
      <div class="header-row-1">
        <div class="location-block" id="header-loc-btn">
          <div class="loc-icon"><i class="fa-solid fa-location-dot"></i></div>
          <div class="loc-text">
            <div class="loc-tag">${escapeHtml(locTag)} <i class="fa-solid fa-chevron-down"></i></div>
            <div class="loc-full">${escapeHtml(locFull)}</div>
          </div>
        </div>
        ${_user
          ? `<div class="header-avatar" id="header-avatar">${initial}</div>`
          : `<a href="#/login" class="btn btn-primary btn-sm"><i class="fa-solid fa-right-to-bracket"></i> Login</a>`}
      </div>
      <div class="search-bar" id="header-search">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="text" placeholder="Search for chef, dish or cuisine" id="search-input" />
        <i class="fa-solid fa-microphone search-mic"></i>
      </div>
    </div>`;

  $('#header-loc-btn')?.addEventListener('click', openAddressSheet);
  $('#header-avatar')?.addEventListener('click', () => navigate('/profile'));

  const inp = $('#search-input');
  inp?.addEventListener('keydown', e => {
    if(e.key === 'Enter' && inp.value.trim()){
      navigate(`/chefs?q=${encodeURIComponent(inp.value.trim())}`);
    }
  });
}

// ============================================
// BOTTOM NAV
// ============================================
function renderBottomNav(active=''){
  const n = $('#bottom-nav');
  if(!n) return;
  n.innerHTML = `
    <div class="nav-inner">
      <a href="#/" class="nav-item ${active==='home'?'active':''}">
        <i class="fa-solid fa-house"></i><span>Home</span>
      </a>
      <a href="#/orders" class="nav-item ${active==='orders'?'active':''}">
        <i class="fa-solid fa-receipt"></i><span>Orders</span>
      </a>
      <a href="#/cart" class="nav-item ${active==='cart'?'active':''}">
        <i class="fa-solid fa-cart-shopping"></i>
        <span class="cart-badge nav-badge" style="display:none;">0</span>
        <span>Cart</span>
      </a>
      <a href="#/profile" class="nav-item ${active==='profile'?'active':''}">
        <i class="fa-solid fa-user"></i><span>Profile</span>
      </a>
    </div>`;
  updateBadges();
}

// ============================================
// ADDRESS SHEET
// ============================================
function openAddressSheet(){
  const sheet = $('#address-sheet');
  const body = $('#address-sheet-body');
  const addrs = getAddresses();
  const selId = (getSelectedAddr()||{}).id;
  body.innerHTML = `
    <div class="address-search">
      <i class="fa-solid fa-magnifying-glass"></i>
      <input type="text" placeholder="Search for area, street name…" id="addr-search-input" />
    </div>
    <button class="address-action-btn" id="use-gps-btn">
      <i class="fa-solid fa-location-crosshairs"></i>
      <div style="flex:1;text-align:left;">
        <div>Use my current location</div>
        <small style="font-weight:400;font-size:.75rem;opacity:.85;">Uses your device GPS</small>
      </div>
      <i class="fa-solid fa-chevron-right"></i>
    </button>
    <button class="address-action-btn" style="background:var(--bg-tint);color:var(--ink-2);" id="add-new-addr-btn">
      <i class="fa-solid fa-plus"></i>
      <div style="flex:1;text-align:left;">Add a new address</div>
      <i class="fa-solid fa-chevron-right"></i>
    </button>
    <h4 style="font-size:.75rem;color:var(--ink-3);letter-spacing:.1em;text-transform:uppercase;margin:16px 0 8px;">Saved addresses</h4>
    ${addrs.length ? addrs.map(a => `
      <div class="saved-addr-item ${a.id===selId?'selected':''}" data-select="${a.id}">
        <div class="saved-addr-icon"><i class="fa-solid ${a.tag==='Home'?'fa-house':a.tag==='Work'?'fa-briefcase':'fa-location-dot'}"></i></div>
        <div class="saved-addr-info">
          <strong>${escapeHtml(a.tag)} ${a.id===selId?'<i class="fa-solid fa-circle-check" style="color:var(--success);font-size:.8rem;"></i>':''}</strong>
          <p>${escapeHtml(a.fullAddress)}</p>
        </div>
        <div class="saved-addr-actions">
          <button data-edit="${a.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
          <button data-del="${a.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>`).join('') : `<p style="color:var(--ink-3);text-align:center;padding:20px;font-size:.88rem;">No saved addresses. Add your first one!</p>`}
  `;

  sheet.classList.add('open');

  $('#use-gps-btn').onclick = () => { sheet.classList.remove('open'); openMapSheet(); };
  $('#add-new-addr-btn').onclick = () => { sheet.classList.remove('open'); openMapSheet(); };
  body.querySelectorAll('[data-select]').forEach(el => el.onclick = e => {
    if(e.target.closest('[data-edit],[data-del]')) return;
    setSelectedAddr(el.dataset.select); sheet.classList.remove('open'); toast('Delivery address updated');
    renderHeader();
  });
  body.querySelectorAll('[data-edit]').forEach(el => el.onclick = e => {
    e.stopPropagation();
    const a = getAddresses().find(x => x.id===el.dataset.edit);
    sheet.classList.remove('open');
    openMapSheet(a);
  });
  body.querySelectorAll('[data-del]').forEach(el => el.onclick = e => {
    e.stopPropagation();
    if(!confirm('Delete this address?')) return;
    saveAddresses(getAddresses().filter(x => x.id!==el.dataset.del));
    toast('Address deleted','success');
    openAddressSheet();
    renderHeader();
  });
}
$('#close-address-sheet')?.addEventListener('click', () => $('#address-sheet').classList.remove('open'));

// ============================================
// MAP SHEET (Leaflet + Nominatim reverse geocode)
// ============================================
let _map = null;
let _marker = null;
let _editingAddr = null;
let _mapAddress = { lat:null, lng:null, fullAddress:'' };

function openMapSheet(editAddr=null){
  const sheet = $('#map-sheet');
  _editingAddr = editAddr;

  $('#map-sheet-title').innerHTML = `<i class="fa-solid fa-map-location-dot"></i> ${editAddr?'Edit address':'Add new address'}`;
  $('#addr-house').value = editAddr?.house || '';
  $('#addr-area').value  = editAddr?.area || '';
  $$('#addr-tags .tag').forEach(t => t.classList.toggle('active', t.dataset.tag === (editAddr?.tag || 'Home')));

  sheet.classList.add('open');

  const initLat = editAddr?.lat || 19.0760;   // Mumbai default
  const initLng = editAddr?.lng || 72.8777;
  _mapAddress = { lat:initLat, lng:initLng, fullAddress: editAddr?.fullAddress || '' };
  $('#map-addr-title').textContent = editAddr?.fullAddress?.split(',')[0] || 'Detecting location…';
  $('#map-addr-sub').textContent   = editAddr?.fullAddress || 'Move the pin to fine-tune';

  // Give sheet a moment to render before init
  setTimeout(() => {
    if(_map){ _map.remove(); _map = null; }
    const container = $('#map-container');
    container.innerHTML = '<div class="map-pin-overlay"><i class="fa-solid fa-location-dot"></i></div>';
    _map = L.map(container, { zoomControl:true, attributionControl:true }).setView([initLat, initLng], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:'&copy; OpenStreetMap',
      maxZoom:19
    }).addTo(_map);
    _map.on('moveend', () => {
      const c = _map.getCenter();
      _mapAddress.lat = c.lat; _mapAddress.lng = c.lng;
      reverseGeocode(c.lat, c.lng);
    });
    if(!editAddr) tryGetLocation(true);
    else reverseGeocode(initLat, initLng);
    setTimeout(()=>_map.invalidateSize(), 200);
  }, 100);
}

$('#close-map-sheet')?.addEventListener('click', () => {
  $('#map-sheet').classList.remove('open');
  if(_map){ _map.remove(); _map = null; }
});

$('#use-current-loc')?.addEventListener('click', () => tryGetLocation(false));

function tryGetLocation(silent){
  if(!navigator.geolocation){ if(!silent) toast('Geolocation not supported','error'); return; }
  if(!silent) toast('Fetching location…','success',1500);
  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude, longitude } = pos.coords;
      _mapAddress.lat = latitude; _mapAddress.lng = longitude;
      if(_map) _map.setView([latitude, longitude], 17);
      reverseGeocode(latitude, longitude);
    },
    err => { if(!silent) toast('Could not get location: ' + err.message, 'error'); },
    { enableHighAccuracy:true, timeout:8000 }
  );
}

let _geoTimer = null;
async function reverseGeocode(lat, lng){
  $('#map-addr-title').textContent = 'Locating…';
  $('#map-addr-sub').textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  clearTimeout(_geoTimer);
  _geoTimer = setTimeout(async () => {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`, {
        headers:{ 'Accept':'application/json' }
      });
      const data = await res.json();
      const addr = data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      const short = data.address ? (data.address.suburb || data.address.neighbourhood || data.address.village || data.address.town || data.address.city || 'Selected location') : 'Selected location';
      _mapAddress.fullAddress = addr;
      $('#map-addr-title').textContent = short;
      $('#map-addr-sub').textContent = addr;
    } catch(e){
      _mapAddress.fullAddress = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      $('#map-addr-title').textContent = 'Custom location';
      $('#map-addr-sub').textContent = _mapAddress.fullAddress;
    }
  }, 400);
}

$$('#addr-tags .tag').forEach(t => t.addEventListener('click', () => {
  $$('#addr-tags .tag').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
}));

$('#save-address-btn')?.addEventListener('click', () => {
  const house = $('#addr-house').value.trim();
  const area = $('#addr-area').value.trim();
  const tag = $$('#addr-tags .tag.active')[0]?.dataset.tag || 'Home';
  if(!house){ toast('Please enter house/flat details','error'); return; }
  if(!_mapAddress.fullAddress){ toast('Please wait for location to load','warning'); return; }
  const fullAddress = `${house}${area ? ', ' + area : ''}, ${_mapAddress.fullAddress}`;
  const list = getAddresses();
  if(_editingAddr){
    const idx = list.findIndex(a => a.id === _editingAddr.id);
    if(idx >= 0) list[idx] = { ..._editingAddr, house, area, tag, fullAddress, lat:_mapAddress.lat, lng:_mapAddress.lng };
  } else {
    list.push({ id:'a_'+Date.now()+Math.random().toString(36).slice(2,7), house, area, tag, fullAddress, lat:_mapAddress.lat, lng:_mapAddress.lng });
  }
  saveAddresses(list);
  // if none selected, pick the newest
  if(!localStorage.getItem(SEL_ADDR_KEY) || !list.find(a=>a.id===localStorage.getItem(SEL_ADDR_KEY))){
    setSelectedAddr(list[list.length-1].id);
  } else if(_editingAddr) {
    setSelectedAddr(_editingAddr.id);
  } else {
    setSelectedAddr(list[list.length-1].id);
  }
  $('#map-sheet').classList.remove('open');
  if(_map){ _map.remove(); _map = null; }
  toast('Address saved','success');
  renderHeader();
  if(parseRoute().seg[0]==='cart') viewCart(); // re-render if on cart
});

// ============================================
// VIEW: HOME
// ============================================
async function viewHome(){
  const root = $('#app-root');
  const categories = [
    ['North Indian','1603894584373-5ac82b2ae398'],
    ['South Indian','1668236543090-82eba5ee5976'],
    ['Bengali','1631452180519-c014fe946bc7'],
    ['Biryani','1563379091339-03b21ab4a4f8'],
    ['Chinese','1585032226651-759b368d7246'],
    ['Continental','1567620905732-2d1ec7ab7445'],
    ['Desserts','1551024506-0bccd828d307'],
    ['Beverages','1544145945-f90425340c7e']
  ];

  root.innerHTML = `
    <section class="hero-banner">
      <div class="hero-banner-content">
        <h1>Home-cooked meals<br/><span>in 45 minutes</span></h1>
        <p>Real chefs. Real kitchens. Real love.</p>
        <div class="hero-badge-row">
          <span class="hero-chip"><i class="fa-solid fa-shield-heart"></i> FSSAI verified</span>
          <span class="hero-chip"><i class="fa-solid fa-bolt"></i> 45 min promise</span>
        </div>
      </div>
      <div class="hero-banner-img"></div>
    </section>

    <section class="section">
      <div class="section-head">
        <div class="section-title">What's on your mind?</div>
      </div>
      <div class="category-scroll">
        ${categories.map(([n,i]) => `
          <div class="category-card" data-cuisine="${escapeHtml(n)}">
            <div class="category-img"><img src="https://images.unsplash.com/photo-${i}?w=200&q=80" alt="${escapeHtml(n)}" loading="lazy" onerror="this.src='${FALLBACK_DISH}'" /></div>
            <div class="category-name">${escapeHtml(n)}</div>
          </div>`).join('')}
      </div>
    </section>

    <div class="trust-strip">
      <div class="trust-item"><i class="fa-solid fa-shield-heart"></i><h5>Verified</h5><p>FSSAI kitchens</p></div>
      <div class="trust-item"><i class="fa-solid fa-heart"></i><h5>Home-made</h5><p>Cooked with love</p></div>
      <div class="trust-item"><i class="fa-solid fa-bolt"></i><h5>45 min</h5><p>Guaranteed</p></div>
      <div class="trust-item"><i class="fa-solid fa-lock"></i><h5>Secure</h5><p>Safe payments</p></div>
    </div>

    <section class="section">
      <div class="section-head">
        <div class="section-title">Top rated home chefs</div>
        <a href="#/chefs" class="section-link">See all <i class="fa-solid fa-arrow-right"></i></a>
      </div>
      <div class="chef-scroll" id="featured-chefs">${Array(3).fill('<div class="chef-card skeleton" style="height:260px;"></div>').join('')}</div>
    </section>

    <section class="section">
      <div class="section-head">
        <div class="section-title">Popular near you</div>
      </div>
      <div class="dish-grid" id="trending-dishes">${Array(4).fill('<div class="dish-card skeleton" style="height:135px;border:none;"></div>').join('')}</div>
    </section>
  `;

  $$('.category-card').forEach(c => c.onclick = () => navigate(`/chefs?cuisine=${encodeURIComponent(c.dataset.cuisine)}`));

  // Load in parallel
  const [chefsSnap, dishesSnap] = await Promise.all([
    getDocs(collection(db,'chefs')).catch(()=>null),
    getDocs(collection(db,'dishes')).catch(()=>null)
  ]);

  const chefsBox = $('#featured-chefs');
  if(!chefsSnap || chefsSnap.empty){
    chefsBox.innerHTML = `<p style="padding:12px;color:var(--ink-3);">No chefs yet. Check back soon.</p>`;
  } else {
    const chefs = []; chefsSnap.forEach(d => chefs.push({ id:d.id, ...d.data() }));
    chefs.sort((a,b)=>(b.rating||0)-(a.rating||0));
    chefsBox.innerHTML = chefs.slice(0,6).map(chef => chefCardHTML(chef)).join('');
  }

  const dishBox = $('#trending-dishes');
  if(!dishesSnap || dishesSnap.empty){
    dishBox.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><div class="empty-illust"><i class="fa-solid fa-utensils"></i></div><h3>Kitchens warming up…</h3><p>No dishes listed yet. Please check back soon.</p></div>`;
  } else {
    const dishes = []; dishesSnap.forEach(d => dishes.push({ id:d.id, ...d.data() }));
    dishes.sort((a,b)=>(b.rating||0)-(a.rating||0));
    dishBox.innerHTML = dishes.slice(0,8).map(dishCardHTML).join('');
    wireDishActions();
  }
}

function chefCardHTML(chef){
  return `
    <a href="#/chef/${chef.id}" class="chef-card">
      <img class="chef-cover" src="${chef.cover||chef.photo||FALLBACK_CHEF}" alt="${escapeHtml(chef.name)}" loading="lazy" onerror="this.src='${FALLBACK_CHEF}'" />
      <span class="chef-offer-badge">20% OFF</span>
      <div class="chef-card-body">
        <div class="chef-name">${escapeHtml(chef.name)}</div>
        <div class="chef-cuisine">${escapeHtml(chef.cuisine||'Home cooking')}</div>
        <div class="chef-meta">
          <span class="rating-pill"><i class="fa-solid fa-star"></i> ${chef.rating||'4.8'}</span>
          <span class="dot">•</span>
          <span>${chef.deliveryTime||45} min</span>
          <span class="dot">•</span>
          <span>${escapeHtml(chef.city||'India')}</span>
        </div>
      </div>
    </a>`;
}

function dishCardHTML(dish){
  const inCart = getCart().find(i=>i.id===dish.id);
  const dataAttr = `data-dish-id="${dish.id}"`;
  return `
    <div class="dish-card">
      <div class="dish-info">
        <div class="dish-veg-mark ${dish.veg?'veg':'non-veg'}" title="${dish.veg?'Vegetarian':'Non-vegetarian'}"></div>
        <div class="dish-name">${escapeHtml(dish.name)}</div>
        <div class="dish-chef">by ${escapeHtml(dish.chefName||'Home chef')}</div>
        <div class="dish-price-row">
          ${fmt(dish.price)}
          <span class="dish-rating"><i class="fa-solid fa-star"></i> ${dish.rating||'4.7'}</span>
        </div>
        <div class="dish-desc">${escapeHtml(dish.description||'A warm, hand-crafted home-style dish.')}</div>
      </div>
      <div class="dish-thumb-wrap">
        <img class="dish-thumb" src="${dish.image||FALLBACK_DISH}" alt="${escapeHtml(dish.name)}" loading="lazy" onerror="this.src='${FALLBACK_DISH}'" />
        ${inCart
          ? `<div class="qty-inline"><button data-dec="${dish.id}">−</button><span data-qty="${dish.id}">${inCart.qty}</span><button data-inc-dish='${escapeAttr(dish)}'>+</button></div>`
          : `<button class="dish-add-btn" data-add='${escapeAttr(dish)}'>ADD</button>`}
      </div>
    </div>`;
}

function escapeAttr(dish){
  return JSON.stringify({ id:dish.id, name:dish.name, price:dish.price, image:dish.image, chefName:dish.chefName, chefId:dish.chefId }).replace(/'/g,'&#39;');
}

function wireDishActions(root=document){
  root.querySelectorAll('[data-add]').forEach(b => b.onclick = e => {
    e.preventDefault();
    const d = JSON.parse(b.dataset.add.replace(/&#39;/g,"'"));
    addToCart(d);
    b.textContent = '✓ ADDED'; b.classList.add('added');
    setTimeout(() => refreshDishCard(d.id), 400);
  });
  root.querySelectorAll('[data-inc-dish]').forEach(b => b.onclick = e => {
    e.preventDefault();
    const d = JSON.parse(b.dataset.incDish.replace(/&#39;/g,"'"));
    addToCart(d); refreshDishCard(d.id);
  });
  root.querySelectorAll('[data-dec]').forEach(b => b.onclick = e => {
    e.preventDefault();
    updateQty(b.dataset.dec, -1); refreshDishCard(b.dataset.dec);
  });
}

function refreshDishCard(dishId){
  // rebuild all dish cards in the current view efficiently
  const currentDish = _dishCache[dishId];
  if(!currentDish) { window.dispatchEvent(new Event('cart-updated')); return; }
  document.querySelectorAll(`[data-dish-id]`).forEach(()=>{}); // (no-op safety)
  // Simple approach: re-render dish-grid children by mapping stored HTML
  const grids = document.querySelectorAll('.dish-grid, .menu-items');
  grids.forEach(g => {
    // for each dish card in grid, find id and rebuild
    Array.from(g.children).forEach(card => {
      const addBtn = card.querySelector('[data-add],[data-inc-dish]');
      const attr = addBtn?.dataset.add || addBtn?.dataset.incDish;
      if(!attr) return;
      try {
        const d = JSON.parse(attr.replace(/&#39;/g,"'"));
        if(d.id === dishId){
          const wrapper = document.createElement('div');
          wrapper.innerHTML = dishCardHTML({ ..._dishCache[d.id], ...d });
          card.replaceWith(wrapper.firstElementChild);
        }
      } catch{}
    });
  });
  wireDishActions();
}

// Simple dish cache to enable refresh
const _dishCache = {};

// ============================================
// VIEW: CHEFS LIST
// ============================================
async function viewChefs(qs){
  const root = $('#app-root');
  const searchTerm = (qs.get('q') || '').toLowerCase();
  let activeCuisine = qs.get('cuisine') || 'all';
  let activeSort = 'rating';

  root.innerHTML = `
    <div class="page">
      <div class="page-title">${searchTerm ? `Results for "${escapeHtml(searchTerm)}"` : 'Home chefs near you'}</div>
      <div class="page-sub">Meet the real people cooking your next meal.</div>
    </div>
    <div class="filter-bar" id="filter-bar">
      <button class="filter-chip ${activeCuisine==='all'?'active':''}" data-cuisine="all"><i class="fa-solid fa-globe"></i> All</button>
      ${['North Indian','South Indian','Bengali','Continental','Chinese','Biryani'].map(c => `
        <button class="filter-chip ${activeCuisine===c?'active':''}" data-cuisine="${c}">${c}</button>`).join('')}
    </div>
    <div class="chef-list" id="chef-list">${Array(3).fill('<div class="chef-list-card skeleton" style="height:280px;border:none;"></div>').join('')}</div>
  `;

  let allChefs = [];
  try {
    const snap = await getDocs(collection(db,'chefs'));
    snap.forEach(d => allChefs.push({ id:d.id, ...d.data() }));
  } catch(e){ $('#chef-list').innerHTML = `<p style="color:var(--danger);padding:24px;">Failed to load: ${e.message}</p>`; return; }

  const grid = $('#chef-list');
  if(!allChefs.length){
    grid.innerHTML = `<div class="empty-state"><div class="empty-illust"><i class="fa-solid fa-user-tie"></i></div><h3>No chefs onboarded yet</h3><p>Our home chefs are still tying their aprons. Please check back soon.</p></div>`;
    return;
  }

  const render = () => {
    let list = allChefs.slice();
    if(activeCuisine !== 'all') list = list.filter(c => (c.cuisine||'').toLowerCase().includes(activeCuisine.toLowerCase()));
    if(searchTerm) list = list.filter(c =>
      (c.name||'').toLowerCase().includes(searchTerm) ||
      (c.cuisine||'').toLowerCase().includes(searchTerm) ||
      (c.signature||'').toLowerCase().includes(searchTerm)
    );
    list.sort((a,b)=>(b.rating||0)-(a.rating||0));
    if(!list.length){
      grid.innerHTML = `<div class="empty-state"><h3>No matches</h3><p>Try a different filter.</p></div>`;
      return;
    }
    grid.innerHTML = list.map(chef => `
      <a href="#/chef/${chef.id}" class="chef-list-card">
        <img class="chef-list-cover" src="${chef.cover||chef.photo||FALLBACK_CHEF}" alt="${escapeHtml(chef.name)}" loading="lazy" onerror="this.src='${FALLBACK_CHEF}'" />
        <span class="chef-offer-badge">20% OFF</span>
        <div class="chef-list-body">
          <div class="chef-list-name">${escapeHtml(chef.name)}</div>
          <div class="chef-list-info">${escapeHtml(chef.cuisine||'Home cooking')} • ${escapeHtml(chef.city||'India')}</div>
          ${chef.signature ? `<div style="font-size:.82rem;color:var(--ink-2);"><i class="fa-solid fa-utensils" style="color:var(--primary);margin-right:4px;"></i>${escapeHtml(chef.signature)}</div>` : ''}
          <div class="chef-list-meta">
            <span class="rating-pill"><i class="fa-solid fa-star"></i> ${chef.rating||'4.8'}</span>
            <span class="time-pill"><i class="fa-solid fa-bolt"></i> 45 min</span>
            <span style="color:var(--ink-3);"><i class="fa-solid fa-bag-shopping"></i> ${escapeHtml(String(chef.orders||'500+'))}</span>
          </div>
        </div>
      </a>`).join('');
  };
  render();

  $('#filter-bar').addEventListener('click', e => {
    const chip = e.target.closest('.filter-chip');
    if(!chip) return;
    $$('.filter-chip').forEach(c=>c.classList.remove('active'));
    chip.classList.add('active');
    activeCuisine = chip.dataset.cuisine;
    render();
  });
}

// ============================================
// VIEW: CHEF DETAIL
// ============================================
async function viewChefDetail(chefId){
  const root = $('#app-root');
  root.innerHTML = loaderHTML("Loading chef's kitchen…");
  if(!chefId){ root.innerHTML = emptyStateHTML('No chef selected','','/chefs','Browse chefs'); return; }
  try {
    const chefSnap = await getDoc(doc(db,'chefs',chefId));
    if(!chefSnap.exists()){ root.innerHTML = emptyStateHTML('Chef not found','','/chefs','Browse chefs'); return; }
    const chef = { id:chefSnap.id, ...chefSnap.data() };

    const [dishSnap, reviewSnap] = await Promise.all([
      getDocs(query(collection(db,'dishes'), where('chefId','==',chefId))),
      getDocs(query(collection(db,'reviews'), where('chefId','==',chefId)))
    ]);
    const dishes = []; dishSnap.forEach(d => { const dat = { id:d.id, ...d.data() }; dishes.push(dat); _dishCache[dat.id] = dat; });
    const reviews = []; reviewSnap.forEach(d => reviews.push({ id:d.id, ...d.data() }));

    const categories = [...new Set(dishes.map(d => d.category || 'Mains'))];
    const cover = chef.cover || chef.photo || FALLBACK_CHEF;

    root.innerHTML = `
      <button class="icon-btn chef-back-btn" onclick="history.back()"><i class="fa-solid fa-arrow-left"></i></button>
      <div class="chef-hero" style="background-image:url('${cover}')">
        <div class="chef-hero-content">
          <h1>${escapeHtml(chef.name)}</h1>
          <div class="chef-hero-meta">
            <span class="rating-pill"><i class="fa-solid fa-star"></i> ${chef.rating||'4.8'}</span>
            <span>•</span>
            <span><i class="fa-solid fa-bolt"></i> 45 min</span>
            <span>•</span>
            <span><i class="fa-solid fa-utensils"></i> ${escapeHtml(chef.cuisine||'Home cooking')}</span>
          </div>
        </div>
      </div>
      <div class="chef-bio-card">
        <h4>About ${escapeHtml((chef.name||'').split(' ')[0])}</h4>
        <p>${escapeHtml(chef.bio||`${chef.name} has been cooking home-style ${chef.cuisine||'Indian'} food for years, sharing family recipes with anyone who craves a taste of home.`)}</p>
        <div class="chef-bio-stats">
          <div class="chef-bio-stat"><span>Total orders</span><strong>${escapeHtml(String(chef.orders||'500+'))}</strong></div>
          <div class="chef-bio-stat"><span>City</span><strong>${escapeHtml(chef.city||'India')}</strong></div>
        </div>
      </div>

      ${categories.length === 0 ? `
        <div class="empty-state"><div class="empty-illust"><i class="fa-solid fa-utensils"></i></div><h3>Menu coming soon</h3><p>${escapeHtml(chef.name)} is still perfecting the recipes.</p></div>
      ` : categories.map(cat => `
        <div>
          <h2 class="menu-category-title">${escapeHtml(cat)} (${dishes.filter(d => (d.category||'Mains')===cat).length})</h2>
          <div class="dish-grid menu-items">
            ${dishes.filter(d => (d.category||'Mains')===cat).map(d => dishCardHTML({ ...d, chefName:chef.name, chefId:chef.id })).join('')}
          </div>
        </div>
      `).join('')}

      <div class="reviews-block">
        <h2 class="menu-category-title" style="padding-left:0;">Reviews (${reviews.length})</h2>
        ${reviews.length ? reviews.map(r => `
          <div class="review-item">
            <div class="review-head">
              <div class="review-user"><i class="fa-solid fa-circle-user"></i> ${escapeHtml(r.userName||'Anonymous')}</div>
              <div class="review-stars">${'★'.repeat(r.rating||5)}${'☆'.repeat(5-(r.rating||5))}</div>
            </div>
            <p class="review-text">${escapeHtml(r.text||'')}</p>
            <div class="review-date">${formatDate(r.createdAt)}</div>
          </div>`).join('') : `<p style="color:var(--ink-3);text-align:center;padding:20px;">No reviews yet — be the first!</p>`}
      </div>
    `;

    wireDishActions();
  } catch(e){
    root.innerHTML = `<p style="color:var(--danger);padding:24px;">${e.message}</p>`;
  }
}

const emptyStateHTML = (title, desc, href, cta) => `
  <div class="empty-state">
    <div class="empty-illust"><i class="fa-solid fa-utensils"></i></div>
    <h3>${escapeHtml(title)}</h3>
    ${desc?`<p>${escapeHtml(desc)}</p>`:''}
    ${href?`<a href="#${href}" class="btn btn-primary">${escapeHtml(cta)}</a>`:''}
  </div>`;

// ============================================
// VIEW: CART
// ============================================
const DELIVERY_FEE = 40;
const TAX_RATE = 0.05;

function viewCart(){
  const root = $('#app-root');
  const cart = getCart();
  if(!cart.length){
    root.innerHTML = `<div class="page"><div class="page-title">Your cart</div></div>
      <div class="empty-state">
        <div class="empty-illust"><i class="fa-solid fa-cart-shopping"></i></div>
        <h3>Your cart is empty</h3>
        <p>Head over to our chefs and pick something delicious.</p>
        <a href="#/" class="btn btn-primary"><i class="fa-solid fa-utensils"></i> Browse chefs</a>
      </div>`;
    return;
  }

  const subtotal = cartTotal();
  const tax = Math.round(subtotal * TAX_RATE);
  const total = subtotal + DELIVERY_FEE + tax;
  const addr = getSelectedAddr();

  root.innerHTML = `
    <div class="page">
      <div class="page-title">Your cart</div>
      <div class="page-sub">${cart.length} item${cart.length>1?'s':''} · Chef warming the pan</div>
    </div>
    <div class="cart-body">
      <!-- Delivery address selector -->
      <div class="addr-selector" id="cart-addr-selector">
        <div class="addr-icon"><i class="fa-solid fa-location-dot"></i></div>
        <div class="addr-selector-body">
          <div class="addr-selector-tag">Deliver to ${addr ? escapeHtml(addr.tag) : 'Set address'}</div>
          <div class="addr-selector-text">${addr ? escapeHtml(addr.fullAddress) : 'Tap to add delivery address'}</div>
        </div>
        <i class="fa-solid fa-chevron-right"></i>
      </div>

      <div class="cart-card">
        <h3><i class="fa-solid fa-bag-shopping" style="color:var(--primary);"></i> Items</h3>
        ${cart.map(item => `
          <div class="cart-item">
            <img class="cart-item-img" src="${item.image||FALLBACK_DISH}" alt="${escapeHtml(item.name)}" onerror="this.src='${FALLBACK_DISH}'" />
            <div class="cart-item-info">
              <h4>${escapeHtml(item.name)}</h4>
              <div class="cart-item-chef">by ${escapeHtml(item.chefName||'Home chef')}</div>
              <div class="cart-item-price">${fmt(item.price)}</div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
              <div class="qty-controls">
                <button data-dec="${item.id}">−</button>
                <span>${item.qty}</span>
                <button data-inc="${item.id}">+</button>
              </div>
              <button style="color:var(--ink-4);font-size:.75rem;" data-remove="${item.id}"><i class="fa-solid fa-trash-can"></i> Remove</button>
            </div>
          </div>`).join('')}
      </div>

      <div class="cart-card">
        <h3><i class="fa-solid fa-phone" style="color:var(--primary);"></i> Contact</h3>
        <div class="form-group">
          <label>Phone number</label>
          <input class="input" id="phone-input" type="tel" placeholder="+91 98765 43210" value="${escapeHtml(localStorage.getItem('hp_phone')||'')}" />
        </div>
      </div>

      <div class="cart-card">
        <h3><i class="fa-solid fa-wallet" style="color:var(--primary);"></i> Payment method</h3>
        <label class="payment-option">
          <input type="radio" name="payment" value="cod" checked />
          <div>
            <strong><i class="fa-solid fa-money-bill-wave" style="color:var(--success);"></i> Cash on Delivery</strong>
            <span>Pay when your food arrives</span>
          </div>
        </label>
      </div>

      <div class="cart-card">
        <h3><i class="fa-solid fa-receipt" style="color:var(--primary);"></i> Bill details</h3>
        <div class="summary-row"><span>Item total</span><span>${fmt(subtotal)}</span></div>
        <div class="summary-row"><span>Delivery fee</span><span>${fmt(DELIVERY_FEE)}</span></div>
        <div class="summary-row"><span>Taxes & charges (5%)</span><span>${fmt(tax)}</span></div>
        <div class="summary-row total"><span>To pay</span><span>${fmt(total)}</span></div>
      </div>

      <div style="height:80px;"></div>
    </div>

    <div class="checkout-fab" id="place-order-btn">
      <div class="checkout-fab-total">
        <span>${cart.length} item${cart.length>1?'s':''}</span>
        <strong>${fmt(total)}</strong>
      </div>
      <span><i class="fa-solid fa-arrow-right"></i> Place Order</span>
    </div>
  `;

  $('#cart-addr-selector').onclick = openAddressSheet;
  root.querySelectorAll('[data-inc]').forEach(b => b.onclick = () => { updateQty(b.dataset.inc, +1); viewCart(); });
  root.querySelectorAll('[data-dec]').forEach(b => b.onclick = () => { updateQty(b.dataset.dec, -1); viewCart(); });
  root.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => { removeItem(b.dataset.remove); toast('Removed from cart'); viewCart(); });

  $('#place-order-btn').onclick = placeOrder;
}

async function placeOrder(){
  const user = auth.currentUser;
  if(!user){ toast('Please login to place order','warning'); setTimeout(()=>navigate('/login'),700); return; }
  const addr = getSelectedAddr();
  if(!addr){ toast('Please add a delivery address','error'); openAddressSheet(); return; }
  const phone = $('#phone-input')?.value?.trim();
  if(!phone){ toast('Please enter your phone number','error'); return; }
  localStorage.setItem('hp_phone', phone);

  const btn = $('#place-order-btn');
  btn.style.pointerEvents = 'none';
  btn.innerHTML = `<span></span><span>Placing order…</span>`;

  const cart = getCart();
  const subtotal = cartTotal();
  const tax = Math.round(subtotal * TAX_RATE);
  const total = subtotal + DELIVERY_FEE + tax;

  try {
    const now = new Date();
    const eta = new Date(now.getTime() + 45*60*1000);
    const orderData = {
      userId: user.uid,
      userName: user.displayName || user.email.split('@')[0],
      userEmail: user.email,
      items: cart,
      subtotal, deliveryFee: DELIVERY_FEE, tax, total,
      address: addr.fullAddress,
      addressDetails: addr,
      phone,
      status: 'Placed',
      paymentMethod: 'Cash on Delivery',
      createdAt: serverTimestamp(),
      orderTimestamp: now.toISOString(),
      estimatedDelivery: eta.toISOString()
    };
    const docRef = await addDoc(collection(db,'orders'), orderData);
    await set(ref(rtdb,'orderStatus/'+docRef.id), {
      status:'Placed', updatedAt:Date.now(),
      orderTimestamp:now.getTime(), estimatedDelivery:eta.getTime()
    });
    clearCart();
    toast('Order placed! Redirecting to tracking…','success');
    setTimeout(() => navigate('/track/'+docRef.id), 900);
  } catch(e){
    console.error(e);
    toast('Failed to place order: '+e.message,'error');
    viewCart();
  }
}

// ============================================
// VIEW: TRACK
// ============================================
const STEPS = ['Placed','Preparing','Out for Delivery','Delivered'];
const STEP_ICONS = { 'Placed':'fa-receipt','Preparing':'fa-fire-burner','Out for Delivery':'fa-motorcycle','Delivered':'fa-house-chimney-window' };
const STEP_DESC = {
  'Placed':'Your order was placed — chef notified.',
  'Preparing':'Chef is cooking your meal with love.',
  'Out for Delivery':'Your food is on its way — warm and packed.',
  'Delivered':'Enjoy your meal! ❤️'
};
let _countdownTimer = null;

async function viewTrack(orderId){
  const root = $('#app-root');
  root.innerHTML = loaderHTML('Locating your order…');
  const user = await requireAuth();
  if(!user) return;
  if(!orderId){ root.innerHTML = emptyStateHTML('No order to track','','/orders','See my orders'); return; }

  try {
    const snap = await getDoc(doc(db,'orders',orderId));
    if(!snap.exists()){ root.innerHTML = emptyStateHTML('Order not found','','/orders','See my orders'); return; }
    const order = { id:snap.id, ...snap.data() };
    renderTrack(order, order.status||'Placed');
    onValue(ref(rtdb,'orderStatus/'+orderId), s => {
      const v = s.val();
      if(v?.status) renderTrack(order, v.status);
    });
    if(_countdownTimer) clearInterval(_countdownTimer);
    if(order.estimatedDelivery) startCountdown(order.estimatedDelivery);
  } catch(e){
    root.innerHTML = `<p style="color:var(--danger);padding:24px;">${e.message}</p>`;
  }
}

function renderTrack(order, currentStatus){
  const idx = STEPS.indexOf(currentStatus);
  const chefName = (order.items?.[0]?.chefName) || 'Your home chef';
  $('#app-root').innerHTML = `
    <div class="track-page">
      <div class="track-card">
        <div class="track-eta">
          <div class="track-eta-label"><i class="fa-solid fa-clock"></i> Arriving in</div>
          <div class="track-countdown" id="countdown">${currentStatus==='Delivered'?'Delivered':'45:00'}</div>
          <div class="track-chef"><i class="fa-solid fa-user-tie"></i> Chef <strong>${escapeHtml(chefName)}</strong> · Order #${order.id.slice(-6).toUpperCase()}</div>
        </div>
        <div class="stepper">
          ${STEPS.map((s,i) => `
            <div class="step ${i<idx?'completed':i===idx?'active':''}">
              <div class="step-dot">${i<idx?'<i class="fa-solid fa-check"></i>':`<i class="fa-solid ${STEP_ICONS[s]}"></i>`}</div>
              <h4>${s==='Placed'?'Order Placed':s==='Preparing'?'Chef Cooking':s}</h4>
              <p>${STEP_DESC[s]}</p>
            </div>`).join('')}
        </div>
        <div style="margin-top:24px;padding-top:16px;border-top:1px solid var(--line);">
          <h4 style="margin-bottom:10px;font-family:var(--font-display);"><i class="fa-solid fa-receipt" style="color:var(--primary);"></i> Order details</h4>
          ${(order.items||[]).map(i => `<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:.9rem;"><span>${i.qty} × ${escapeHtml(i.name)}</span><span>${fmt(i.price*i.qty)}</span></div>`).join('')}
          <div class="summary-row total" style="margin-top:8px;"><span>Total (Cash on Delivery)</span><span>${fmt(order.total)}</span></div>
          <p style="margin-top:14px;color:var(--ink-3);font-size:.85rem;">
            <i class="fa-solid fa-location-dot"></i> ${escapeHtml(order.address||'')}<br/>
            <i class="fa-solid fa-phone"></i> ${escapeHtml(order.phone||'')}
          </p>
        </div>
        <div style="display:flex;gap:8px;margin-top:16px;">
          <a href="#/orders" class="btn btn-outline btn-block"><i class="fa-solid fa-list"></i> My orders</a>
          <a href="#/" class="btn btn-primary btn-block"><i class="fa-solid fa-utensils"></i> Order again</a>
        </div>
      </div>
    </div>`;
}

function startCountdown(etaIso){
  const eta = new Date(etaIso).getTime();
  const tick = () => {
    const el = $('#countdown'); if(!el){ clearInterval(_countdownTimer); return; }
    const diff = eta - Date.now();
    if(diff <= 0){ el.textContent = 'Arriving now'; return; }
    const m = Math.floor(diff/60000), s = Math.floor((diff%60000)/1000);
    el.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  };
  tick();
  _countdownTimer = setInterval(tick, 1000);
}

// ============================================
// VIEW: ORDERS
// ============================================
let selectedOrderId = null;
let selectedRating = 0;

async function viewOrders(){
  const root = $('#app-root');
  root.innerHTML = `
    <div class="page"><div class="page-title">My orders</div><div class="page-sub">All your past cravings.</div></div>
    <div id="orders-root">${loaderHTML('Fetching your orders…')}</div>`;
  const user = await requireAuth(); if(!user) return;

  try {
    const snap = await getDocs(query(collection(db,'orders'), where('userId','==',user.uid)));
    const orders = []; snap.forEach(d => orders.push({ id:d.id, ...d.data() }));
    orders.sort((a,b) => {
      const ta = a.createdAt?.toMillis?.() || new Date(a.orderTimestamp||0).getTime();
      const tb = b.createdAt?.toMillis?.() || new Date(b.orderTimestamp||0).getTime();
      return tb - ta;
    });
    const container = $('#orders-root');
    if(!orders.length){
      container.innerHTML = `<div class="empty-state"><div class="empty-illust"><i class="fa-solid fa-receipt"></i></div><h3>No orders yet</h3><p>Your order history will appear here.</p><a href="#/" class="btn btn-primary"><i class="fa-solid fa-utensils"></i> Browse chefs</a></div>`;
      return;
    }
    container.innerHTML = `<div class="order-list">
      ${orders.map(o => {
        const statusClass = 'status-' + (o.status||'Placed').toLowerCase().replace(/\s+/g,'');
        const items = (o.items||[]).map(i => `${i.qty} × ${escapeHtml(i.name)}`).join(', ');
        const dateText = o.createdAt ? formatDate(o.createdAt) : formatDate(o.orderTimestamp);
        return `
          <div class="order-card">
            <div class="order-head">
              <div>
                <div class="order-id">#${o.id.slice(-6).toUpperCase()}</div>
                <div class="order-date">${dateText}</div>
              </div>
              <span class="order-status ${statusClass}">${escapeHtml(o.status||'Placed')}</span>
            </div>
            <div class="order-items-preview"><i class="fa-solid fa-utensils" style="color:var(--primary);"></i> ${items}</div>
            <div class="order-addr"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(o.address||'')}</div>
            <div class="order-foot">
              <span class="order-total">${fmt(o.total)}</span>
              <div class="order-actions">
                ${o.status!=='Delivered' ? `<a href="#/track/${o.id}" class="btn btn-outline btn-sm"><i class="fa-solid fa-route"></i> Track</a>` : ''}
                <button class="btn btn-ghost btn-sm" data-reorder='${JSON.stringify(o.items).replace(/'/g,'&#39;')}'><i class="fa-solid fa-rotate-right"></i> Reorder</button>
                ${o.status==='Delivered' && !o.reviewed ? `<button class="btn btn-primary btn-sm" data-rate="${o.id}"><i class="fa-solid fa-star"></i> Rate</button>` : ''}
              </div>
            </div>
          </div>`;
      }).join('')}
    </div>`;

    container.querySelectorAll('[data-reorder]').forEach(b => b.onclick = () => {
      const items = JSON.parse(b.dataset.reorder.replace(/&#39;/g,"'"));
      items.forEach(i => addToCart(i));
      toast('Items added to cart','success');
      setTimeout(() => navigate('/cart'), 600);
    });
    container.querySelectorAll('[data-rate]').forEach(b => b.onclick = () => {
      selectedOrderId = b.dataset.rate;
      selectedRating = 0;
      $('#review-text').value = '';
      $$('#rating-stars .star').forEach(s => s.classList.remove('active'));
      $('#review-modal').classList.add('open');
    });
  } catch(e){
    $('#orders-root').innerHTML = `<p style="color:var(--danger);padding:24px;">${e.message}</p>`;
  }
}

// Review modal wiring (once)
function wireReviewModal(){
  $('#review-close')?.addEventListener('click', () => $('#review-modal').classList.remove('open'));
  $$('#rating-stars .star').forEach(s => s.addEventListener('click', () => {
    selectedRating = parseInt(s.dataset.val);
    $$('#rating-stars .star').forEach(x => x.classList.toggle('active', parseInt(x.dataset.val) <= selectedRating));
  }));
  $('#submit-review')?.addEventListener('click', async () => {
    if(!selectedRating) return toast('Please choose a rating','error');
    const text = $('#review-text').value.trim();
    if(!text) return toast('Please write a short review','error');
    const user = auth.currentUser;
    if(!user) return toast('Please login','error');
    try {
      const snap = await getDocs(query(collection(db,'orders'), where('userId','==',user.uid)));
      let order = null;
      snap.forEach(d => { if(d.id === selectedOrderId) order = { id:d.id, ...d.data() }; });
      const first = order?.items?.[0] || {};
      await addDoc(collection(db,'reviews'), {
        userId:user.uid, userName:user.displayName||user.email.split('@')[0],
        orderId:selectedOrderId, dishId:first.id||'', chefId:first.chefId||'', chefName:first.chefName||'',
        rating:selectedRating, text, createdAt:serverTimestamp()
      });
      toast('Thanks for your review! ❤️','success');
      $('#review-modal').classList.remove('open');
    } catch(e){ toast('Failed: '+e.message,'error'); }
  });
}

// ============================================
// VIEW: PROFILE
// ============================================
function viewProfile(){
  const root = $('#app-root');
  if(!_user){
    root.innerHTML = `
      <div class="auth-container">
        <div class="auth-hero">
          <div class="auth-hero-icon"><i class="fa-solid fa-user"></i></div>
          <h2>Welcome to HomePlate</h2>
          <p>Login to view your orders, saved addresses, and more.</p>
        </div>
        <a href="#/login" class="btn btn-primary btn-block btn-lg"><i class="fa-solid fa-right-to-bracket"></i> Login / Sign up</a>
      </div>`;
    return;
  }
  const initial = (_user.displayName || _user.email || 'U')[0].toUpperCase();
  const addrCount = getAddresses().length;
  root.innerHTML = `
    <div class="profile-header">
      <div class="profile-header-inner">
        <div class="profile-avatar-lg">${initial}</div>
        <div>
          <div class="profile-name">${escapeHtml(_user.displayName || _user.email.split('@')[0])}</div>
          <div class="profile-email">${escapeHtml(_user.email||'')}</div>
        </div>
      </div>
    </div>
    <div class="profile-menu">
      <div class="profile-menu-card">
        <a href="#/orders" class="profile-menu-item">
          <div class="profile-menu-icon"><i class="fa-solid fa-receipt"></i></div>
          <div class="profile-menu-text">My orders <small>Track, reorder, review</small></div>
          <i class="fa-solid fa-chevron-right"></i>
        </a>
        <div class="profile-menu-item" id="prof-addr">
          <div class="profile-menu-icon"><i class="fa-solid fa-location-dot"></i></div>
          <div class="profile-menu-text">My addresses <small>${addrCount} saved</small></div>
          <i class="fa-solid fa-chevron-right"></i>
        </div>
        <a href="#/cart" class="profile-menu-item">
          <div class="profile-menu-icon"><i class="fa-solid fa-cart-shopping"></i></div>
          <div class="profile-menu-text">Cart <small>${cartCount()} items</small></div>
          <i class="fa-solid fa-chevron-right"></i>
        </a>
      </div>

      <div class="profile-menu-card" style="margin-top:14px;">
        <div class="profile-menu-item">
          <div class="profile-menu-icon" style="background:#e0f2fe;color:#0369a1;"><i class="fa-solid fa-headset"></i></div>
          <div class="profile-menu-text">Help & support <small>Get in touch with us</small></div>
          <i class="fa-solid fa-chevron-right"></i>
        </div>
        <div class="profile-menu-item">
          <div class="profile-menu-icon" style="background:#fef3c7;color:#a16207;"><i class="fa-solid fa-shield-halved"></i></div>
          <div class="profile-menu-text">Privacy & terms <small>Legal information</small></div>
          <i class="fa-solid fa-chevron-right"></i>
        </div>
        <div class="profile-menu-item">
          <div class="profile-menu-icon" style="background:#dcfce7;color:#166534;"><i class="fa-solid fa-star"></i></div>
          <div class="profile-menu-text">Rate HomePlate <small>Tell us how we're doing</small></div>
          <i class="fa-solid fa-chevron-right"></i>
        </div>
      </div>

      <div class="profile-menu-card" style="margin-top:14px;">
        <div class="profile-menu-item" id="prof-logout">
          <div class="profile-menu-icon" style="background:#fee2e2;color:#dc2626;"><i class="fa-solid fa-right-from-bracket"></i></div>
          <div class="profile-menu-text" style="color:#dc2626;">Log out</div>
        </div>
      </div>

      <p style="text-align:center;color:var(--ink-4);font-size:.75rem;margin-top:24px;padding-bottom:20px;">
        Made with <i class="fa-solid fa-heart" style="color:var(--primary);"></i> in India<br/>
        HomePlate v2.0
      </p>
    </div>`;

  $('#prof-addr').onclick = openAddressSheet;
  $('#prof-logout').onclick = async () => {
    if(!confirm('Log out?')) return;
    await signOut(auth);
    toast('Logged out','success');
    setTimeout(()=>navigate('/'),500);
  };
}

// ============================================
// VIEW: LOGIN
// ============================================
function viewLogin(qs){
  const root = $('#app-root');
  const nextUrl = qs.get('next') || '/';
  root.innerHTML = `
    <div class="auth-container">
      <div class="auth-hero">
        <div class="auth-hero-icon"><i class="fa-solid fa-utensils"></i></div>
        <h2>Welcome to HomePlate</h2>
        <p>Order home-cooked meals from real chefs.</p>
      </div>
      <div class="auth-tabs">
        <button type="button" class="auth-tab active" data-tab="login">Login</button>
        <button type="button" class="auth-tab" data-tab="signup">Sign up</button>
      </div>
      <form id="auth-form">
        <div class="form-group" id="name-group" style="display:none;">
          <label>Full name</label>
          <input class="input" id="name" type="text" placeholder="Your name" />
        </div>
        <div class="form-group">
          <label>Email</label>
          <input class="input" id="email" type="email" placeholder="you@example.com" required autocomplete="email" />
        </div>
        <div class="form-group">
          <label>Password</label>
          <input class="input" id="password" type="password" placeholder="••••••••" required minlength="6" autocomplete="current-password" />
        </div>
        <button type="submit" class="btn btn-primary btn-block btn-lg" id="submit-btn"><i class="fa-solid fa-right-to-bracket"></i> Login</button>
      </form>
      <div class="divider">or continue with</div>
      <button type="button" class="google-btn" id="google-btn">
        <svg width="20" height="20" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A10.99 10.99 0 0 0 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.99 10.99 0 0 0 1 12c0 1.77.43 3.45 1.18 4.93l3.66-2.84z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Continue with Google
      </button>
      <p style="text-align:center;color:var(--ink-4);font-size:.75rem;margin-top:20px;">
        <i class="fa-solid fa-shield-halved"></i> Secure login · By continuing you agree to our terms.
      </p>
    </div>`;

  let mode = 'login';
  const redirect = () => setTimeout(()=>navigate(nextUrl),600);
  $$('.auth-tab').forEach(t => t.onclick = () => {
    $$('.auth-tab').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    mode = t.dataset.tab;
    $('#name-group').style.display = mode==='signup' ? 'block' : 'none';
    $('#submit-btn').innerHTML = mode==='signup' ? '<i class="fa-solid fa-user-plus"></i> Create account' : '<i class="fa-solid fa-right-to-bracket"></i> Login';
  });

  $('#auth-form').onsubmit = async e => {
    e.preventDefault();
    const email = $('#email').value.trim();
    const password = $('#password').value;
    const name = $('#name').value.trim();
    const btn = $('#submit-btn');
    const orig = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = 'Please wait…';
    try {
      if(mode==='signup'){
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        if(name) await updateProfile(cred.user, { displayName:name });
        toast('Account created! Welcome to HomePlate.','success');
      } else {
        await signInWithEmailAndPassword(auth, email, password);
        toast('Login successful!','success');
      }
      redirect();
    } catch(err){
      toast(err.message.replace('Firebase: ',''),'error');
      btn.disabled = false; btn.innerHTML = orig;
    }
  };

  $('#google-btn').onclick = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      toast('Login successful!','success');
      redirect();
    } catch(err){ toast(err.message.replace('Firebase: ',''),'error'); }
  };
}

// ============================================
// ROUTER
// ============================================
function route(){
  const { seg, qs } = parseRoute();
  const page = seg[0] || 'home';
  if(_countdownTimer && page !== 'track'){ clearInterval(_countdownTimer); _countdownTimer = null; }
  window.scrollTo(0,0);

  const activeMap = { home:'home', chefs:'home', chef:'home', cart:'cart', orders:'orders', profile:'profile' };
  renderHeader();
  renderBottomNav(activeMap[page] || '');

  switch(page){
    case 'home': viewHome(); break;
    case 'chefs': viewChefs(qs); break;
    case 'chef': viewChefDetail(seg[1]); break;
    case 'cart': viewCart(); break;
    case 'orders': viewOrders(); break;
    case 'track': viewTrack(seg[1]); break;
    case 'profile': viewProfile(); break;
    case 'login': viewLogin(qs); break;
    default:
      $('#app-root').innerHTML = emptyStateHTML('Page not found', "The page you're looking for doesn't exist.", '/', 'Go home');
  }
}

// ============================================
// BOOT
// ============================================
window.addEventListener('cart-updated', updateBadges);
window.addEventListener('addr-changed', renderHeader);
window.addEventListener('hashchange', route);

// Prevent pinch-zoom (extra safety on top of viewport meta)
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault(), { passive:false });

onAuthStateChanged(auth, u => {
  _user = u;
  renderHeader();
  renderBottomNav((parseRoute().seg[0]||'home'));
});

wireReviewModal();
if(!window.location.hash) window.location.hash = '#/';
route();
