const API_URL = 'https://script.google.com/macros/s/AKfycbyxFlO5vTm1l4iDwwvLyuyMu7oWwfAq6vEZxc-i1iy5j2PVM0FLzJpUVSLxOGTY6aeSoA/exec';

let currentUser = null;
let currentBag = null;
let currentMode = null;
let users = [];
let contenants = [];
let articles = [];
let vehicles = [];
let stock = [];
let pochons = [];
let selectedItems = {};
let inventaireManques = [];
let currentInventaireFilter = 'all';
let currentPeremptionFilter = 'alerts';
let qrScanner = null;
let leaderboardData = [];

document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
});

async function loadData() {
  // Nettoyer l'ancien Service Worker
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      registration.unregister();
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      for (const key of keys) {
        await caches.delete(key);
      }
    }
  }

  showLoading(true);
  try {
    const response = await fetch(`${API_URL}?action=getData`);
    const data = await response.json();
    users = data.users || [];
    contenants = data.contenants || [];
    articles = data.articles || [];
    stock = data.stock || [];
    pochons = data.pochons || [];
    vehicles = data.vehicles || [];
    
    // Charger le classement
    await loadLeaderboard();
    
    populateUserSelect();
  } catch (error) {
    console.error('Error loading data:', error);
    showToast('Erreur de chargement', 'error');
  }
  showLoading(false);
}

function populateUserSelect() {
  const select = document.getElementById('login-user');
  select.innerHTML = '<option value="">Choisir un utilisateur...</option>';
  users.forEach(user => {
    select.innerHTML += `<option value="${user.id_utilisateur}">${user.nom}</option>`;
  });
}

document.getElementById('btn-login').addEventListener('click', login);
document.getElementById('login-pin').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') login();
});

function login() {
  const userId = document.getElementById('login-user').value;
  const pin = document.getElementById('login-pin').value;

  if (!userId) {
    showToast('Sélectionne un utilisateur', 'error');
    return;
  }

  // Trouver l'utilisateur dans les données déjà chargées
  const user = users.find(u => u.id_utilisateur === userId);
  
  if (!user || String(user.code_pin) !== pin) {
    showToast('Code incorrect', 'error');
    document.getElementById('login-pin').value = '';
    return;
  }

  // Vérifier que l'utilisateur est actif
  if (user.actif !== true && user.actif !== 'TRUE') {
    showToast('Compte inactif', 'error');
    return;
  }

  // Stocker l'utilisateur avec TOUTES ses données (y compris stats)
  currentUser = {
    id: user.id_utilisateur,
    nom: user.nom,
    role: user.role,
    total_operations: parseInt(user.total_operations) || 0,
    rank: user.rank,
    badges: user.badges_list || []
  };

  document.getElementById('home-user-name').textContent = user.nom.split(' ')[0];
  document.getElementById('current-user-name').textContent = user.nom;
  
  // Afficher le générateur QR pour admin et logistique
  const qrCard = document.getElementById('qr-generator-card');
  if (user.role === 'admin' || user.role === 'logistique') {
    qrCard.style.display = 'flex';
  } else {
    qrCard.style.display = 'none';
  }
  
  // Afficher le rang et les badges
  displayUserRank();
  
  updateHomeBadges();
  goToScreen('screen-home');
  showToast(`Bienvenue ${user.nom} !`, 'success');
}

function logout() {
  currentUser = null;
  currentBag = null;
  currentMode = null;
  selectedItems = {};
  document.getElementById('login-pin').value = '';
  stopScanner();
  goToScreen('screen-login');
}

function updateHomeBadges() {
  const peremptionAlerts = countPeremptionAlerts();
  const badge = document.getElementById('peremption-badge');
  if (peremptionAlerts.total > 0) {
    badge.textContent = peremptionAlerts.total;
    badge.style.display = 'block';
  } else {
    badge.style.display = 'none';
  }

  const totalManques = contenants.reduce((sum, bag) => {
    const bagStock = stock.filter(s => s.id_contenant === bag.id_contenant);
    return sum + bagStock.filter(s => s.quantite < s.quantite_cible).length;
  }, 0);
  
  const invBadge = document.getElementById('inventaire-badge');
  if (totalManques > 0) {
    invBadge.textContent = totalManques;
    invBadge.style.display = 'block';
  } else {
    invBadge.style.display = 'none';
  }
}

function enterMode(mode) {
  currentMode = mode;
  
  switch (mode) {
    /*case 'intervention':
      goToScreen('screen-scan');
      if (qrScanner) {
        qrScanner.stop();
      }
      document.getElementById('qr-reader').style.display = 'none';
      document.getElementById('scan-placeholder').style.display = 'block';
      break;
      
    case 'inventaire':
      showBagSelector('inventaire');
      break;
      
    case 'peremption':
      showPeremptionScreen();
      break;
      
    case 'vehicles':
      showVehiclesScreen();
      break;
      
    case 'qrcode':
      showQRGenerator();
      break;*/

    case 'intervention': populateBagList(); goToScreen('screen-scan'); break;
    case 'inventaire': populateInventaireBagList(); goToScreen('screen-inventaire-select'); break;
    case 'peremption': populatePeremption(); goToScreen('screen-peremption'); break;
    case 'qrcode': populateContenantSelection(); goToScreen('screen-qrcode'); break;
    case 'vehicles': populateVehicles(); goToScreen('screen-vehicles'); break;
      
    case 'leaderboard':
      showLeaderboard();
      break;
      
    default:
      console.log('Mode inconnu:', mode);
  }
}

function populateBagList() {
  const list = document.getElementById('bag-list');
  list.innerHTML = '';
  const sorted = [...contenants].sort((a, b) => a.type === 'armoire' ? 1 : b.type === 'armoire' ? -1 : 0);
  sorted.forEach(bag => {
    const bagStock = stock.filter(s => s.id_contenant === bag.id_contenant);
    const count = bagStock.reduce((sum, s) => sum + s.quantite, 0);
    const icon = bag.type === 'armoire' ? '🗄️' : '🎒';
    list.innerHTML += `
      <div class="bag-item" onclick="selectBag('${bag.id_contenant}')">
        <div class="bag-icon ${bag.couleur}">${icon}</div>
        <div class="bag-info">
          <h4>${bag.nom}</h4>
          <p>${bag.localisation} • ${count} articles</p>
        </div>
        <span class="bag-arrow">›</span>
      </div>`;
  });
}

function selectBag(bagId) {
  currentBag = contenants.find(c => c.id_contenant === bagId);
  selectedItems = {};
  populateInventory();
  goToScreen('screen-inventory');
}

document.getElementById('btn-scan').addEventListener('click', toggleScanner);

async function toggleScanner() {
  const btn = document.getElementById('btn-scan');
  const placeholder = document.getElementById('scan-placeholder');
  const readerEl = document.getElementById('qr-reader');
  const scanArea = document.getElementById('scan-area');

  if (qrScanner) { stopScanner(); return; }

  try {
    placeholder.style.display = 'none';
    readerEl.style.display = 'block';
    scanArea.classList.add('scanning');
    btn.textContent = '⏹ Arrêter le scan';
    qrScanner = new Html5Qrcode('qr-reader');
    await qrScanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 250, height: 250 } }, onQrCodeScanned, () => {});
  } catch (error) {
    showToast('Impossible d\'accéder à la caméra', 'error');
    stopScanner();
  }
}

function stopScanner() {
  const btn = document.getElementById('btn-scan');
  const placeholder = document.getElementById('scan-placeholder');
  const readerEl = document.getElementById('qr-reader');
  const scanArea = document.getElementById('scan-area');
  if (qrScanner) { qrScanner.stop().catch(() => {}); qrScanner = null; }
  placeholder.style.display = 'flex';
  readerEl.style.display = 'none';
  scanArea.classList.remove('scanning');
  btn.textContent = '📷 Activer la caméra';
}

function onQrCodeScanned(qrCode) {
  const bag = contenants.find(c => c.id_contenant === qrCode);
  if (bag) { stopScanner(); selectBag(bag.id_contenant); showToast(`${bag.nom} identifié !`, 'success'); }
  else { showToast('QR code non reconnu', 'error'); }
}

function populateInventory() {
  const header = document.getElementById('bag-header');
  header.className = `bag-header ${currentBag.couleur}`;
  document.getElementById('bag-title').textContent = currentBag.nom;
  document.getElementById('bag-subtitle').textContent = currentBag.localisation;

  const bagStock = stock.filter(s => s.id_contenant === currentBag.id_contenant);
  const bagPochons = pochons.filter(p => p.id_contenant === currentBag.id_contenant);
  const total = bagStock.reduce((sum, s) => sum + s.quantite, 0);
  const hasIssues = bagStock.some(s => s.quantite < s.quantite_cible);

  document.getElementById('stat-articles').textContent = total;
  document.getElementById('stat-pochons').textContent = bagPochons.length || '-';
  document.getElementById('stat-status').textContent = hasIssues ? '⚠️' : '✓';

  const content = document.getElementById('inventory-content');
  content.innerHTML = '';

  const grouped = {};
  bagStock.forEach(s => { const key = s.id_pochon || 'vrac'; if (!grouped[key]) grouped[key] = []; grouped[key].push(s); });

  const sortedKeys = Object.keys(grouped).sort((a, b) => {
    if (a === 'vrac') return 1; if (b === 'vrac') return -1;
    const pA = pochons.find(p => p.id_pochon === a);
    const pB = pochons.find(p => p.id_pochon === b);
    return (pA?.ordre || 0) - (pB?.ordre || 0);
  });

  sortedKeys.forEach(pochonId => {
    const items = grouped[pochonId];
    const pochon = pochons.find(p => p.id_pochon === pochonId) || { nom: 'Vrac', couleur: 'gray' };
    let html = `<div class="pochon-section"><div class="pochon-header"><div class="pochon-dot ${pochon.couleur}"></div><h3>${pochon.nom}</h3><span>${items.length} type${items.length > 1 ? 's' : ''}</span></div>`;
    items.forEach(item => {
      const article = articles.find(a => a.id_article === item.id_article) || {};
      const stockClass = item.quantite >= item.quantite_cible ? 'stock-ok' : item.quantite >= item.quantite_cible / 2 ? 'stock-low' : 'stock-critical';
      const selected = selectedItems[item.id_article] || 0;
      html += `<div class="item-card ${selected > 0 ? 'selected' : ''}" id="item-${item.id_article}">
        <div class="item-top">
          <div class="item-icon">${article.emoji || '📦'}</div>
          <div class="item-details">
            <h4>${article.nom || 'Article inconnu'}</h4>
            <p>${article.description || ''}</p>
          </div>
        </div>
        <div class="item-bottom">
          <span class="stock-indicator ${stockClass}">×${item.quantite}</span>
          <div class="item-qty">
            <button class="qty-btn" onclick="updateQty('${item.id_article}', -1, ${item.quantite})">−</button>
            <span class="qty-value ${selected > 0 ? 'active' : ''}" id="qty-${item.id_article}">${selected}</span>
            <button class="qty-btn" onclick="updateQty('${item.id_article}', 1, ${item.quantite})">+</button>
          </div>
        </div>
      </div>`;
    });
    html += '</div>';
    content.innerHTML += html;
  });
  updateValidateButton();
}

function updateQty(articleId, delta, maxQty) {
  const current = selectedItems[articleId] || 0;
  const newQty = Math.max(0, Math.min(current + delta, maxQty));
  if (newQty === 0) delete selectedItems[articleId]; else selectedItems[articleId] = newQty;
  const qtyEl = document.getElementById(`qty-${articleId}`);
  const cardEl = document.getElementById(`item-${articleId}`);
  qtyEl.textContent = newQty;
  qtyEl.classList.toggle('active', newQty > 0);
  cardEl.classList.toggle('selected', newQty > 0);
  updateValidateButton();
}

function updateValidateButton() {
  const total = Object.values(selectedItems).reduce((sum, qty) => sum + qty, 0);
  document.getElementById('selected-count').textContent = total;
  document.getElementById('btn-validate').disabled = total === 0;
}

document.getElementById('btn-validate').addEventListener('click', () => { populateDestination(); goToScreen('screen-destination'); });

function populateDestination() {
  const container = document.getElementById('selected-items');
  container.innerHTML = '';
  Object.entries(selectedItems).forEach(([articleId, qty]) => {
    const article = articles.find(a => a.id_article === articleId) || {};
    container.innerHTML += `<div class="selected-item"><span class="emoji">${article.emoji || '📦'}</span><span class="name">${article.nom || 'Article'}</span><span class="qty">×${qty}</span></div>`;
  });

  const transferSelect = document.getElementById('transfer-target');
  transferSelect.innerHTML = '<option value="">Choisir le sac destination...</option>';
  const targets = currentBag.type === 'armoire' ? contenants.filter(c => c.type === 'sac') : contenants.filter(c => c.id_contenant !== currentBag.id_contenant && c.type === 'sac');
  targets.forEach(c => { transferSelect.innerHTML += `<option value="${c.id_contenant}">${c.nom}</option>`; });

  const retourOption = document.querySelector('[data-dest="retour"]');
  retourOption.style.display = currentBag.type === 'armoire' ? 'none' : '';

  document.querySelectorAll('.dest-option').forEach(el => el.classList.remove('selected'));
  document.querySelector('[data-dest="victime"]').classList.add('selected');
  document.getElementById('movement-note').value = '';
}

function selectDestination(el) {
  document.querySelectorAll('.dest-option').forEach(opt => { opt.classList.remove('selected'); const subOpts = opt.querySelector('.sub-options'); if (subOpts) subOpts.style.display = 'none'; });
  el.classList.add('selected');
  const subOpts = el.querySelector('.sub-options');
  if (subOpts) subOpts.style.display = 'block';
}

document.getElementById('btn-confirm').addEventListener('click', confirmMovement);

async function confirmMovement() {
  const destOption = document.querySelector('.dest-option.selected');
  const destType = destOption.dataset.dest;
  const note = document.getElementById('movement-note').value;

  let destination = null;
  if (destType === 'transfert') { destination = document.getElementById('transfer-target').value; if (!destination) { showToast('Sélectionnez un sac destination', 'error'); return; } }
  else if (destType === 'retour') { const armoire = contenants.find(c => c.type === 'armoire'); destination = armoire ? armoire.id_contenant : null; }

  const movements = Object.entries(selectedItems).map(([articleId, qty]) => ({
    date_heure: new Date().toISOString(), id_utilisateur: currentUser.id, id_article: articleId, quantite: qty,
    id_contenant_source: currentBag.id_contenant, id_contenant_destination: destination, type_mouvement: destType, note: note
  }));

  showLoading(true);
  try {
    await fetch(`${API_URL}?action=addMovements`, { method: 'POST', body: JSON.stringify({ movements }) });
    movements.forEach(mov => {
      const sourceStock = stock.find(s => s.id_contenant === mov.id_contenant_source && s.id_article === mov.id_article);
      if (sourceStock) sourceStock.quantite -= mov.quantite;
      if (mov.id_contenant_destination) { let destStock = stock.find(s => s.id_contenant === mov.id_contenant_destination && s.id_article === mov.id_article); if (destStock) destStock.quantite += mov.quantite; }
    });
    showToast('Mouvement enregistré !', 'success');
    selectedItems = {};
    updateHomeBadges();
    goToScreen('screen-home');
  } catch (error) { showToast('Erreur lors de l\'enregistrement', 'error'); }
  showLoading(false);
}

function populateInventaireBagList() {
  const list = document.getElementById('inventaire-bag-list');
  list.innerHTML = '';
  const sorted = [...contenants].sort((a, b) => a.type === 'armoire' ? 1 : b.type === 'armoire' ? -1 : 0);
  sorted.forEach(bag => {
    const bagStock = stock.filter(s => s.id_contenant === bag.id_contenant);
    const manques = bagStock.filter(s => s.quantite < s.quantite_cible).length;
    const exces = bagStock.filter(s => s.quantite > s.quantite_cible).length;
    const icon = bag.type === 'armoire' ? '🗄️' : '🎒';
    let statusTags = '';
    if (manques > 0) statusTags += `<span class="status-tag critical">${manques} manquant${manques > 1 ? 's' : ''}</span>`;
    if (exces > 0) statusTags += `<span class="status-tag warning">${exces} excès</span>`;
    if (manques === 0 && exces === 0) statusTags = `<span class="status-tag ok">Complet ✓</span>`;
    list.innerHTML += `<div class="bag-item ${manques > 0 ? 'has-alert' : ''}" onclick="selectBagForInventaire('${bag.id_contenant}')"><div class="bag-icon ${bag.couleur}">${icon}${manques > 0 ? `<div class="alert-dot">${manques}</div>` : ''}</div><div class="bag-info"><h4>${bag.nom}</h4><p>${bag.localisation}</p><div class="bag-status">${statusTags}</div></div><span class="bag-arrow">›</span></div>`;
  });
}

function selectBagForInventaire(bagId) {
  currentBag = contenants.find(c => c.id_contenant === bagId);
  currentInventaireFilter = 'all';
  populateInventaireDetail();
  goToScreen('screen-inventaire-detail');
}

function populateInventaireDetail() {
  const header = document.getElementById('inventaire-header');
  header.className = `bag-header ${currentBag.couleur}`;
  document.getElementById('inventaire-title').textContent = currentBag.nom;
  const bagStock = stock.filter(s => s.id_contenant === currentBag.id_contenant);
  const okCount = bagStock.filter(s => s.quantite === s.quantite_cible).length;
  const manqueCount = bagStock.filter(s => s.quantite < s.quantite_cible).length;
  const excesCount = bagStock.filter(s => s.quantite > s.quantite_cible).length;
  document.getElementById('inventaire-stat-ok').textContent = okCount;
  document.getElementById('inventaire-stat-manque').textContent = manqueCount;
  document.getElementById('inventaire-stat-exces').textContent = excesCount;
  document.getElementById('filter-count-manque').textContent = manqueCount;
  document.getElementById('filter-count-exces').textContent = excesCount;
  
  // Réinitialiser les sélections
  inventaireSelections = {};
  
  // Toujours afficher le bouton, il sera désactivé si rien n'est sélectionné
  document.getElementById('inventaire-floating').style.display = 'block';
  
  renderInventaireContent(bagStock);
  updateInventaireButton();
}

function renderInventaireContent(bagStock) {
  const content = document.getElementById('inventaire-content');
  content.innerHTML = '';
  let filteredStock = bagStock;
  if (currentInventaireFilter === 'manque') filteredStock = bagStock.filter(s => s.quantite < s.quantite_cible);
  else if (currentInventaireFilter === 'exces') filteredStock = bagStock.filter(s => s.quantite > s.quantite_cible);
  if (filteredStock.length === 0) { content.innerHTML = `<div class="empty-state"><div class="icon">✓</div><p>Aucun article dans cette catégorie</p></div>`; return; }
  const grouped = {};
  filteredStock.forEach(s => { const key = s.id_pochon || 'vrac'; if (!grouped[key]) grouped[key] = []; grouped[key].push(s); });
  const sortedKeys = Object.keys(grouped).sort((a, b) => { if (a === 'vrac') return 1; if (b === 'vrac') return -1; const pA = pochons.find(p => p.id_pochon === a); const pB = pochons.find(p => p.id_pochon === b); return (pA?.ordre || 0) - (pB?.ordre || 0); });
  sortedKeys.forEach(pochonId => {
    const items = grouped[pochonId];
    const pochon = pochons.find(p => p.id_pochon === pochonId) || { nom: 'Vrac', couleur: 'gray' };
    let html = `<div class="pochon-section"><div class="pochon-header"><div class="pochon-dot ${pochon.couleur}"></div><h3>${pochon.nom}</h3></div>`;
    items.forEach(item => {
      const article = articles.find(a => a.id_article === item.id_article) || {};
      const ecart = item.quantite - item.quantite_cible;
      let highlightClass = '', stockClass = '';
      
      // Déterminer la classe de mise en évidence et le badge de stock
      if (ecart < 0) {
        highlightClass = Math.abs(ecart) >= item.quantite_cible / 2 ? 'highlight-critical' : 'highlight-low';
        stockClass = Math.abs(ecart) >= item.quantite_cible / 2 ? 'stock-critical' : 'stock-low';
      } else if (ecart > 0) {
        highlightClass = 'highlight-excess';
        stockClass = 'stock-excess';
      } else {
        stockClass = 'stock-ok';
      }

      const selectedQty = inventaireSelections[item.id_article] || 0;

      html += `<div class="item-card ${highlightClass} ${selectedQty > 0 ? 'selected' : ''}" id="inv-item-${item.id_article}">
        <div class="item-top">
          <div class="item-icon">${article.emoji || '📦'}</div>
          <div class="item-details">
            <h4>${article.nom || 'Article inconnu'}</h4>
            <p>${article.description || ''}</p>
          </div>
        </div>
        <div class="item-bottom">
          <div class="stock-info">
            <span class="stock-indicator ${stockClass}">×${item.quantite}</span>
          </div>
          <div class="item-qty">
            <button class="qty-btn" onclick="updateInventaireQty('${item.id_article}', -1, 999, ${item.quantite})">−</button>
            <span class="qty-value ${selectedQty > 0 ? 'active' : ''}" id="inv-qty-${item.id_article}">${selectedQty}</span>
            <span style="color: var(--text-muted); margin: 0 4px;">/</span>
            <span class="qty-value target">${item.quantite_cible}</span>
            <button class="qty-btn" onclick="updateInventaireQty('${item.id_article}', 1, 999, ${item.quantite})">+</button>
          </div>
        </div>
      </div>`;
    });
    html += '</div>';
    content.innerHTML += html;
  });
  updateInventaireButton();
}

function filterInventaire(filter) {
  currentInventaireFilter = filter;
  document.querySelectorAll('#inventaire-filters .filter-tab').forEach(tab => { tab.classList.toggle('active', tab.dataset.filter === filter); });
  const bagStock = stock.filter(s => s.id_contenant === currentBag.id_contenant);
  renderInventaireContent(bagStock);
}


function openSourceModal() {
  const modal = document.getElementById('source-modal');
  const options = document.getElementById('source-options');
  options.innerHTML = '';
  const armoire = contenants.find(c => c.type === 'armoire');
  if (armoire && currentBag.id_contenant !== armoire.id_contenant) {
    options.innerHTML += `<div class="source-option" onclick="completerDepuis('${armoire.id_contenant}')"><div class="icon armoire">🗄️</div><div class="info"><h4>${armoire.nom}</h4><p>${armoire.localisation}</p></div><span class="stock-available">Stock disponible</span></div>`;
  }
  contenants.filter(c => c.id_contenant !== currentBag.id_contenant && c.type !== 'armoire').forEach(contenant => {
    options.innerHTML += `<div class="source-option" onclick="completerDepuis('${contenant.id_contenant}')"><div class="icon sac">🎒</div><div class="info"><h4>${contenant.nom}</h4><p>${contenant.localisation}</p></div></div>`;
  });
  if (options.innerHTML === '') { options.innerHTML = `<div class="empty-state" style="padding: 40px;"><div class="icon">📦</div><p>Aucune source disponible</p></div>`; }
  modal.classList.add('show');
}

function closeSourceModal() { document.getElementById('source-modal').classList.remove('show'); }

// ===== SYSTÈME DE SÉLECTION POUR RÉASSORT GROUPÉ =====
let inventaireSelections = {}; // { id_article: quantité_à_ajouter }

function updateInventaireQty(articleId, delta, maxToAdd, currentQty) {
  const current = inventaireSelections[articleId] || 0;
  // Limite à 999 au lieu de la quantité cible - permet de sur-stocker
  const newQty = Math.max(0, Math.min(current + delta, 999));
  
  if (newQty === 0) {
    delete inventaireSelections[articleId];
  } else {
    inventaireSelections[articleId] = newQty;
  }
  
  // Mettre à jour l'affichage
  const qtyEl = document.getElementById(`inv-qty-${articleId}`);
  const cardEl = document.getElementById(`inv-item-${articleId}`);
  
  if (qtyEl) {
    qtyEl.textContent = newQty;
    qtyEl.classList.toggle('active', newQty > 0);
  }
  
  if (cardEl) {
    cardEl.classList.toggle('selected', newQty > 0);
  }
  
  updateInventaireButton();
}

function updateInventaireButton() {
  const totalArticles = Object.keys(inventaireSelections).length;
  const totalQty = Object.values(inventaireSelections).reduce((sum, qty) => sum + qty, 0);
  
  const button = document.getElementById('btn-reassort-inventory');
  const countSpan = document.getElementById('reassort-count');
  
  if (button) {
    button.disabled = totalArticles === 0;
  }
  
  if (countSpan) {
    countSpan.textContent = totalQty;
  }
}

function openReassortSourceModal() {
  // Vérifier qu'il y a des sélections
  if (Object.keys(inventaireSelections).length === 0) {
    showToast('Aucun article sélectionné', 'error');
    return;
  }

  const modal = document.getElementById('reassort-modal');
  const content = document.getElementById('reassort-modal-content-inner');
  
  // Construire le récapitulatif des articles sélectionnés
  let recapHtml = '<div class="reassort-summary"><h4>Articles à réassortir</h4>';
  
  Object.keys(inventaireSelections).forEach(articleId => {
    const qty = inventaireSelections[articleId];
    const article = articles.find(a => a.id_article === articleId);
    if (article) {
      recapHtml += `
        <div class="reassort-summary-item">
          <span class="emoji">${article.emoji || '📦'}</span>
          <span class="name">${article.nom}</span>
          <span class="qty">×${qty}</span>
        </div>
      `;
    }
  });
  
  recapHtml += '</div>';
  
  // Options de source
  let optionsHtml = '<div class="reassort-section-title">Choisir la source</div>';
  
  // 1. Armoire
  const armoire = contenants.find(c => c.type === 'armoire');
  if (armoire && currentBag.id_contenant !== armoire.id_contenant) {
    const availability = checkSourceAvailability(armoire.id_contenant);
    const disabled = availability.total === 0 ? 'disabled' : '';
    
    optionsHtml += `
      <div class="reassort-option ${disabled}" onclick="${disabled ? '' : `reassortFromSource('${armoire.id_contenant}')`}">
        <div class="icon armoire">🗄️</div>
        <div class="info">
          <h4>${armoire.nom}</h4>
          <p>${availability.available} / ${availability.needed} articles disponibles</p>
        </div>
        <div class="stock-info">
          <div class="stock-value ${availability.total === 0 ? '' : 'ok'}">${availability.total}</div>
          <div class="stock-label">pièces</div>
        </div>
      </div>
    `;
  }
  
  // 2. Autres sacs
  const autresSacs = contenants.filter(c => 
    c.id_contenant !== currentBag.id_contenant && 
    c.type !== 'armoire'
  );
  
  autresSacs.forEach(sac => {
    const availability = checkSourceAvailability(sac.id_contenant);
    const disabled = availability.total === 0 ? 'disabled' : '';
    
    optionsHtml += `
      <div class="reassort-option ${disabled}" onclick="${disabled ? '' : `reassortFromSource('${sac.id_contenant}')`}">
        <div class="icon sac">🎒</div>
        <div class="info">
          <h4>${sac.nom}</h4>
          <p>${availability.available} / ${availability.needed} articles disponibles</p>
        </div>
        <div class="stock-info">
          <div class="stock-value ${availability.total === 0 ? '' : 'ok'}">${availability.total}</div>
          <div class="stock-label">pièces</div>
        </div>
      </div>
    `;
  });
  
  // 3. Entrée manuelle
  optionsHtml += `
    <div class="reassort-option" onclick="reassortManually()">
      <div class="icon manual">✏️</div>
      <div class="info">
        <h4>Entrée manuelle</h4>
        <p>Ajouter directement sans source</p>
      </div>
    </div>
  `;
  
  content.innerHTML = recapHtml + optionsHtml;
  modal.classList.add('show');
}

function checkSourceAvailability(sourceId) {
  let needed = 0;
  let available = 0;
  let total = 0;
  
  Object.keys(inventaireSelections).forEach(articleId => {
    const qtyNeeded = inventaireSelections[articleId];
    needed++;
    
    const sourceStock = stock.find(s => s.id_contenant === sourceId && s.id_article === articleId);
    const qtyAvailable = sourceStock ? sourceStock.quantite : 0;
    total += qtyAvailable;
    
    if (qtyAvailable > 0) {
      available++;
    }
  });
  
  return { needed, available, total };
}

function closeReassortModal() {
  document.getElementById('reassort-modal').classList.remove('show');
}

async function reassortFromSource(sourceId) {
  closeReassortModal();
  showLoading(true);
  
  const movements = [];
  
  // Pour chaque article sélectionné
  Object.keys(inventaireSelections).forEach(articleId => {
    const qtyNeeded = inventaireSelections[articleId];
    const sourceStock = stock.find(s => s.id_contenant === sourceId && s.id_article === articleId);
    
    if (sourceStock && sourceStock.quantite > 0) {
      const qtyToMove = Math.min(qtyNeeded, sourceStock.quantite);
      movements.push({
        date_heure: new Date().toISOString(),
        id_utilisateur: currentUser.id,
        id_article: articleId,
        quantite: qtyToMove,
        id_contenant_source: sourceId,
        id_contenant_destination: currentBag.id_contenant,
        type_mouvement: 'reassort',
        note: 'Réassort inventaire'
      });
    }
  });
  
  if (movements.length === 0) {
    showToast('Aucun article disponible dans cette source', 'error');
    showLoading(false);
    return;
  }
  
  try {
    await fetch(`${API_URL}?action=addMovements`, { method: 'POST', body: JSON.stringify({ movements }) });
    
    // Mettre à jour les stocks locaux
    movements.forEach(mov => {
      const sourceStock = stock.find(s => s.id_contenant === mov.id_contenant_source && s.id_article === mov.id_article);
      if (sourceStock) sourceStock.quantite -= mov.quantite;
      
      const destStock = stock.find(s => s.id_contenant === mov.id_contenant_destination && s.id_article === mov.id_article);
      if (destStock) destStock.quantite += mov.quantite;
    });
    
    const totalMoved = movements.reduce((sum, m) => sum + m.quantite, 0);
    const articlesCount = movements.length;
    
    showToast(`${articlesCount} type${articlesCount > 1 ? 's' : ''} d'articles réassortis (${totalMoved} pièces) !`, 'success');
    
    // Réinitialiser les sélections
    inventaireSelections = {};
    
    // Rafraîchir l'affichage
    populateInventaireDetail();
    populateInventaireBagList();
    updateHomeBadges();
  } catch (error) {
    showToast('Erreur lors du réassort', 'error');
  }
  
  showLoading(false);
}

async function reassortManually() {
  closeReassortModal();
  showLoading(true);
  
  const movements = [];
  
  // Pour chaque article sélectionné
  Object.keys(inventaireSelections).forEach(articleId => {
    const qty = inventaireSelections[articleId];
    movements.push({
      date_heure: new Date().toISOString(),
      id_utilisateur: currentUser.id,
      id_article: articleId,
      quantite: qty,
      id_contenant_source: null, // null = entrée manuelle
      id_contenant_destination: currentBag.id_contenant,
      type_mouvement: 'entree',
      note: 'Entrée manuelle (inventaire)'
    });
  });
  
  try {
    await fetch(`${API_URL}?action=addMovements`, { method: 'POST', body: JSON.stringify({ movements }) });
    
    // Mettre à jour les stocks locaux
    movements.forEach(mov => {
      const destStock = stock.find(s => s.id_contenant === mov.id_contenant_destination && s.id_article === mov.id_article);
      if (destStock) destStock.quantite += mov.quantite;
    });
    
    const totalAdded = movements.reduce((sum, m) => sum + m.quantite, 0);
    const articlesCount = movements.length;
    
    showToast(`${articlesCount} type${articlesCount > 1 ? 's' : ''} d'articles ajoutés (${totalAdded} pièces) !`, 'success');
    
    // Réinitialiser les sélections
    inventaireSelections = {};
    
    // Rafraîchir l'affichage
    populateInventaireDetail();
    populateInventaireBagList();
    updateHomeBadges();
  } catch (error) {
    showToast('Erreur lors de l\'ajout', 'error');
  }
  
  showLoading(false);
}

async function completerDepuis(sourceId) {
  closeSourceModal();
  showLoading(true);
  const movements = [];
  inventaireManques.forEach(item => {
    const sourceStock = stock.find(s => s.id_contenant === sourceId && s.id_article === item.id_article);
    if (sourceStock && sourceStock.quantite > 0) {
      const qtyToMove = Math.min(item.manque, sourceStock.quantite);
      movements.push({ date_heure: new Date().toISOString(), id_utilisateur: currentUser.id, id_article: item.id_article, quantite: qtyToMove, id_contenant_source: sourceId, id_contenant_destination: currentBag.id_contenant, type_mouvement: 'reassort', note: 'Complément inventaire' });
    }
  });
  if (movements.length === 0) { showToast('Aucun article disponible dans cette source', 'error'); showLoading(false); return; }
  try {
    await fetch(`${API_URL}?action=addMovements`, { method: 'POST', body: JSON.stringify({ movements }) });
    movements.forEach(mov => {
      const sourceStock = stock.find(s => s.id_contenant === mov.id_contenant_source && s.id_article === mov.id_article);
      if (sourceStock) sourceStock.quantite -= mov.quantite;
      const destStock = stock.find(s => s.id_contenant === mov.id_contenant_destination && s.id_article === mov.id_article);
      if (destStock) destStock.quantite += mov.quantite;
    });
    const totalMoved = movements.reduce((sum, m) => sum + m.quantite, 0);
    showToast(`${totalMoved} article${totalMoved > 1 ? 's' : ''} ajouté${totalMoved > 1 ? 's' : ''} !`, 'success');
    populateInventaireDetail();
    populateInventaireBagList();
    updateHomeBadges();
  } catch (error) { showToast('Erreur lors du réassort', 'error'); }
  showLoading(false);
}

function countPeremptionAlerts() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let expired = 0, warning = 0;
  stock.forEach(item => {
    if (!item.date_peremption) return;
    const expDate = new Date(item.date_peremption);
    const diffDays = Math.ceil((expDate - today) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) expired++; else if (diffDays <= 30) warning++;
  });
  return { expired, warning, total: expired + warning };
}

function populatePeremption() {
  const alerts = countPeremptionAlerts();
  document.getElementById('peremption-expired-count').textContent = alerts.expired;
  document.getElementById('peremption-warning-count').textContent = alerts.warning;
  renderPeremptionContent();
}

function renderPeremptionContent() {
  const content = document.getElementById('peremption-content');
  content.innerHTML = '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let items = stock.filter(s => s.date_peremption).map(s => {
    const expDate = new Date(s.date_peremption);
    const diffDays = Math.ceil((expDate - today) / (1000 * 60 * 60 * 24));
    const article = articles.find(a => a.id_article === s.id_article) || {};
    const contenant = contenants.find(c => c.id_contenant === s.id_contenant) || {};
    return { ...s, article, contenant, diffDays, status: diffDays < 0 ? 'expired' : diffDays <= 30 ? 'warning' : 'ok' };
  }).sort((a, b) => a.diffDays - b.diffDays);
  if (currentPeremptionFilter === 'alerts') items = items.filter(i => i.status !== 'ok');
  if (items.length === 0) { content.innerHTML = `<div class="empty-state"><div class="icon">✓</div><p>${currentPeremptionFilter === 'alerts' ? 'Aucune alerte de péremption' : 'Aucun article avec date de péremption'}</p></div>`; return; }
  items.forEach(item => {
    const dateStr = new Date(item.date_peremption).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
    let daysText = item.diffDays < 0 ? `Périmé depuis ${Math.abs(item.diffDays)}j` : item.diffDays === 0 ? "Expire aujourd'hui" : `Dans ${item.diffDays}j`;
    content.innerHTML += `<div class="peremption-item ${item.status}"><div class="item-row"><div class="item-icon">${item.article.emoji || '📦'}</div><div class="item-details"><h4>${item.article.nom || 'Article'}</h4><p>×${item.quantite} • ${item.article.description || ''}</p></div><div class="date-badge ${item.status}">${dateStr}<span class="days">${daysText}</span></div></div><div class="location">📍 ${item.contenant.nom || 'Inconnu'}</div></div>`;
  });
}

function filterPeremption(filter) {
  currentPeremptionFilter = filter;
  document.querySelectorAll('#peremption-filters .filter-tab').forEach(tab => { tab.classList.toggle('active', tab.dataset.filter === filter); });
  renderPeremptionContent();
}

function goToScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
  window.scrollTo(0, 0);
  if (screenId !== 'screen-scan') stopScanner();
}

function showLoading(show) { document.getElementById('loading').classList.toggle('show', show); }

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.add('show');
  setTimeout(() => { toast.classList.remove('show'); }, 3000);
}

// ===== QR CODE GENERATOR FUNCTIONS =====
let qrCounter = 0;
let selectedContenants = new Set();

function populateContenantSelection() {
  const list = document.getElementById('contenant-selection-list');
  list.innerHTML = '';
  
  if (contenants.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="icon">📦</div><p>Aucun contenant disponible.</p></div>';
    return;
  }

  contenants.forEach(contenant => {
    const iconClass = contenant.type === 'armoire' ? 'armoire' : 'sac';
    const icon = contenant.type === 'armoire' ? '🗄️' : '🎒';
    const isSelected = selectedContenants.has(contenant.id_contenant);
    
    const item = document.createElement('div');
    item.className = 'bag-card';
    item.style.cursor = 'pointer';
    item.style.position = 'relative';
    item.style.border = isSelected ? '2px solid var(--accent-primary)' : '2px solid var(--border-color)';
    item.style.background = isSelected ? 'var(--bg-highlight)' : 'var(--card-bg)';
    item.onclick = () => toggleContenantSelection(contenant.id_contenant);
    
    item.innerHTML = `
      <div class="bag-icon ${iconClass}">${icon}</div>
      <div class="bag-info">
        <h3>${contenant.nom}</h3>
        <p>${contenant.localisation}</p>
        <p class="bag-id">${contenant.id_contenant}</p>
      </div>
      ${isSelected ? '<div style="position: absolute; top: 10px; right: 10px; font-size: 24px;">✓</div>' : ''}
    `;
    list.appendChild(item);
  });
}

function toggleContenantSelection(id) {
  if (selectedContenants.has(id)) {
    selectedContenants.delete(id);
  } else {
    selectedContenants.add(id);
  }
  populateContenantSelection();
}

function generateQRFromSelection() {
  if (selectedContenants.size === 0) {
    showToast('Veuillez sélectionner au moins un contenant', 'error');
    return;
  }

  selectedContenants.forEach(id => {
    const contenant = contenants.find(c => c.id_contenant === id);
    if (contenant) {
      addQRCardToGrid(contenant.nom, contenant.id_contenant);
    }
  });

  showToast(`${selectedContenants.size} QR code${selectedContenants.size > 1 ? 's' : ''} généré${selectedContenants.size > 1 ? 's' : ''} !`, 'success');
  selectedContenants.clear();
  populateContenantSelection();
}

function addQRCardToGrid(name, id) {
  qrCounter++;
  const cardId = 'qr-card-' + qrCounter;
  const canvasId = 'qr-canvas-' + qrCounter;

  const card = document.createElement('div');
  card.className = 'qr-card-mini';
  card.id = cardId;
  card.innerHTML = `
    <h4>${name}</h4>
    <div class="qr-id">${id}</div>
    <div id="${canvasId}" class="qr-canvas-mini"></div>
    <div class="qr-card-actions">
      <button onclick="downloadQRCode('${canvasId}', '${id}')">💾</button>
      <button onclick="removeQRCard('${cardId}')">🗑️</button>
    </div>
  `;

  document.getElementById('qr-grid-main').appendChild(card);

  // Générer le QR code avec QRCode.js
  setTimeout(() => {
    new QRCode(document.getElementById(canvasId), {
      text: id,
      width: 150,
      height: 150,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H
    });
  }, 100);
}

function downloadQRCode(canvasId, filename) {
  const canvas = document.querySelector(`#${canvasId} canvas`);
  if (!canvas) {
    showToast('Erreur lors de la génération du QR code', 'error');
    return;
  }

  // Créer un canvas avec fond blanc et bordure
  const finalCanvas = document.createElement('canvas');
  const ctx = finalCanvas.getContext('2d');
  const padding = 30;
  finalCanvas.width = canvas.width + (padding * 2);
  finalCanvas.height = canvas.height + (padding * 2);

  // Fond blanc
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);

  // Copier le QR code
  ctx.drawImage(canvas, padding, padding);

  // Télécharger
  finalCanvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `QR_${filename}.png`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('QR code téléchargé !', 'success');
  });
}

function removeQRCard(cardId) {
  document.getElementById(cardId).remove();
  if (document.querySelectorAll('.qr-card-mini').length === 0) {
    qrCounter = 0;
  }
}

function clearAllQR() {
  const cards = document.querySelectorAll('.qr-card-mini');
  if (cards.length === 0) {
    showToast('Aucun QR code à effacer', 'info');
    return;
  }

  if (confirm('Voulez-vous vraiment supprimer tous les QR codes générés ?')) {
    document.getElementById('qr-grid-main').innerHTML = '';
    qrCounter = 0;
    selectedContenants.clear();
    populateContenantSelection();
    showToast('QR codes effacés', 'success');
  }
}

// ===== VEHICLES MODULE =====
let currentVehicleId = null;
let currentVehicleFilter = 'all';
let currentVehicleTab = 'info';

async function loadVehiclesData() {
  // Les véhicules sont chargés avec getAllData au démarrage
}

function populateVehicles() {
  const list = document.getElementById('vehicles-list');
  list.innerHTML = '';
  let filtered = vehicles.filter(v => currentVehicleFilter === 'all' || v.type === currentVehicleFilter);
  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty-state">🚗<br>Aucun véhicule enregistré</div>';
    return;
  }
  
  const today = new Date();
  const alertDays = 30; // Alerte 30 jours avant échéance
  
  filtered.forEach(v => {
    const iconMap = { ambulance: '🚑', car: '🚗', quad: '🏍️', boat: '🚤', trailer: '🚚' };
    const icon = iconMap[v.type] || '🚗';
    
    let alerts = []; // Tableau pour stocker toutes les alertes
    
    // Vérifier les échéances de révision
    const revisions = v.revisions || [];
    const sorted = [...revisions].sort((a, b) => new Date(b.date) - new Date(a.date));
    const lastRevision = sorted[0];
    
    if (lastRevision && lastRevision.next_date) {
      const nextDate = new Date(lastRevision.next_date);
      const daysUntil = Math.ceil((nextDate - today) / (1000 * 60 * 60 * 24));
      if (daysUntil <= alertDays && daysUntil >= 0) {
        alerts.push(`⚠️ Révision dans ${daysUntil}j`);
      } else if (daysUntil < 0) {
        alerts.push('⚠️ Révision dépassée');
      }
    }
    
    // Vérifier les échéances de contrats (trouver le plus urgent)
    const contracts = v.contracts || [];
    let closestContractDays = Infinity;
    let contractAlert = null;
    
    contracts.forEach(c => {
      if (c.date_fin) {
        const endDate = new Date(c.date_fin);
        const daysUntil = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
        
        // Contrat expiré (priorité absolue)
        if (daysUntil < 0 && !contractAlert) {
          contractAlert = '⚠️ Contrat expiré';
          closestContractDays = daysUntil;
        }
        // Contrat proche de l'expiration
        else if (daysUntil >= 0 && daysUntil <= alertDays && daysUntil < closestContractDays) {
          contractAlert = `⚠️ Contrat dans ${daysUntil}j`;
          closestContractDays = daysUntil;
        }
      }
    });
    
    if (contractAlert) {
      alerts.push(contractAlert);
    }
    
    // Générer les badges d'alerte
    const alertBadges = alerts.map(alert => `<span class="stat-badge warning">${alert}</span>`).join('');
    
    list.innerHTML += `<div class="vehicle-card" onclick="showVehicleDetail('${v.id}')"><div class="vehicle-icon ${v.type}">${icon}</div><div class="vehicle-info"><h3>${v.nom}</h3><p>${v.marque} ${v.modele} - ${v.immat}</p><div style="margin-top: 8px"><span class="stat-badge">${v.km.toLocaleString()} km</span>${alertBadges}</div></div></div>`;
  });
}

function filterVehicles(filter) {
  currentVehicleFilter = filter;
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.filter === filter);
  });
  populateVehicles();
}

async function saveVehicle() {
  const nom = document.getElementById('vehicle-nom').value.trim();
  const type = document.getElementById('vehicle-type').value;
  const immat = document.getElementById('vehicle-immat').value.trim().toUpperCase();
  const marque = document.getElementById('vehicle-marque').value.trim();
  const modele = document.getElementById('vehicle-modele').value.trim();
  const annee = parseInt(document.getElementById('vehicle-annee').value) || 0;
  const km = parseInt(document.getElementById('vehicle-km').value) || 0;
  
  if (!nom || !immat || !marque || !modele) {
    showToast('Remplis tous les champs obligatoires', 'error');
    return;
  }
  
  const vehicle = {
    id: currentVehicleId || 'VEH' + String(Math.floor(Math.random() * 900) + 100).padStart(3, '0'),
    nom, type, immat, marque, modele, annee, km
  };
  
  // Ajouter le spinner au bouton
  const saveBtn = document.querySelector('#screen-add-vehicle .btn-success');
  if (saveBtn) saveBtn.classList.add('btn-loading');
  
  showLoading(true);
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ vehicle }),
      headers: { 'Content-Type': 'application/json' }
    });
    const url = `${API_URL}?action=saveVehicle`;
    const result = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ vehicle })
    }).then(r => r.json());
    
    if (result.success) {
      await loadData(); // Recharger toutes les données
      showToast('Véhicule enregistré !', 'success');
      currentVehicleId = null;
      document.getElementById('vehicle-nom').value = '';
      document.getElementById('vehicle-immat').value = '';
      document.getElementById('vehicle-marque').value = '';
      document.getElementById('vehicle-modele').value = '';
      document.getElementById('vehicle-annee').value = '';
      document.getElementById('vehicle-km').value = '';
      populateVehicles();
      goToScreen('screen-vehicles');
    } else {
      showToast(result.error || 'Erreur d\'enregistrement', 'error');
    }
  } catch (error) {
    showToast('Erreur de connexion', 'error');
  }
  if (saveBtn) saveBtn.classList.remove('btn-loading');
  showLoading(false);
}

function showVehicleDetail(id) {
  currentVehicleId = id;
  const v = vehicles.find(ve => ve.id === id);
  if (!v) return;
  
  const iconMap = { ambulance: '🚑', car: '🚗', quad: '🏍️', boat: '🚤', trailer: '🚚' };
  const icon = iconMap[v.type] || '🚗';
  
  document.getElementById('vehicle-detail-title').textContent = v.nom;
  document.getElementById('vehicle-detail-subtitle').textContent = `${icon} ${v.immat}`;
  
  populateVehicleInfo();
  populateVehicleContracts();
  populateVehicleRevisions();
  populateVehicleEvents();
  
  switchVehicleTab('info');
  goToScreen('screen-vehicle-detail');
}

function switchVehicleTab(tabName) {
  currentVehicleTab = tabName;
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === 'tab-' + tabName);
  });
}

function populateVehicleInfo() {
  const v = vehicles.find(ve => ve.id === currentVehicleId);
  if (!v) return;
  
  const typeMap = {
    ambulance: '🚑 Ambulance', car: '🚗 Voiture',
    quad: '🏍️ Quad', boat: '🚤 Bateau', trailer: '🚚 Remorque'
  };
  
  const grid = document.getElementById('vehicle-info-grid');
  grid.innerHTML = `
    <div class="info-item"><label>Type</label><div class="value">${typeMap[v.type] || v.type}</div></div>
    <div class="info-item"><label>Immatriculation</label><div class="value">${v.immat}</div></div>
    <div class="info-item"><label>Marque</label><div class="value">${v.marque}</div></div>
    <div class="info-item"><label>Modèle</label><div class="value">${v.modele}</div></div>
    <div class="info-item"><label>Année</label><div class="value">${v.annee || 'Non renseignée'}</div></div>
    <div class="info-item"><label>Kilométrage</label><div class="value">${v.km ? v.km.toLocaleString() + ' km' : 'Non renseigné'}</div></div>
  `;
}

function editVehicle() {
  const v = vehicles.find(ve => ve.id === currentVehicleId);
  if (!v) return;
  
  document.getElementById('vehicle-nom').value = v.nom;
  document.getElementById('vehicle-type').value = v.type;
  document.getElementById('vehicle-immat').value = v.immat;
  document.getElementById('vehicle-marque').value = v.marque;
  document.getElementById('vehicle-modele').value = v.modele;
  document.getElementById('vehicle-annee').value = v.annee || '';
  document.getElementById('vehicle-km').value = v.km || '';
  goToScreen('screen-add-vehicle');
}

async function deleteVehicle() {
  if (!confirm('Supprimer ce véhicule et toutes ses données ?')) return;
  
  showLoading(true);
  try {
    const url = `${API_URL}?action=deleteVehicle`;
    const result = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ id_vehicule: currentVehicleId })
    }).then(r => r.json());
    
    if (result.success) {
      await loadData();
      showToast('Véhicule supprimé', 'success');
      populateVehicles();
      goToScreen('screen-vehicles');
    } else {
      showToast(result.error || 'Erreur de suppression', 'error');
    }
  } catch (error) {
    showToast('Erreur de connexion', 'error');
  }
  showLoading(false);
}

function populateVehicleContracts() {
  const v = vehicles.find(ve => ve.id === currentVehicleId);
  if (!v) return;
  
  const alert = document.getElementById('next-contract-alert');
  const list = document.getElementById('contracts-list');
  
  alert.innerHTML = '';
  list.innerHTML = '';
  
  if (!v.contracts || v.contracts.length === 0) {
    list.innerHTML = '<div class="empty-state">📄<br>Aucun contrat enregistré</div>';
    return;
  }
  
  const today = new Date();
  const alertDays = 30;
  
  // Trouver le contrat le plus proche de son expiration
  let closestContract = null;
  let closestDays = Infinity;
  let hasExpired = false;
  
  v.contracts.forEach(contract => {
    const endDate = new Date(contract.date_fin);
    const daysUntil = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
    
    if (daysUntil < 0 && !hasExpired) {
      // Contrat expiré
      hasExpired = true;
      closestContract = contract;
      closestDays = daysUntil;
    } else if (daysUntil >= 0 && daysUntil <= alertDays && daysUntil < closestDays) {
      // Contrat proche de l'expiration
      closestContract = contract;
      closestDays = daysUntil;
    }
  });
  
  // Afficher l'alerte pour le contrat le plus urgent
  if (closestContract) {
    const endDate = new Date(closestContract.date_fin);
    const daysUntil = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
    const contractType = closestContract.type === 'assurance' ? 'Assurance' : 'Contrat d\'entretien';
    
    if (daysUntil < 0) {
      alert.innerHTML = `
        <div class="next-revision-alert" style="background: linear-gradient(135deg, var(--accent-red), #ff6b6b);">
          <div class="icon">🚨</div>
          <div>
            <h4>Contrat expiré !</h4>
            <p>${contractType} de ${closestContract.fournisseur} expiré depuis ${Math.abs(daysUntil)} jour${Math.abs(daysUntil) > 1 ? 's' : ''}</p>
          </div>
        </div>
      `;
    } else if (daysUntil <= alertDays) {
      alert.innerHTML = `
        <div class="next-revision-alert">
          <div class="icon">⚠️</div>
          <div>
            <h4>Contrat proche de l'expiration !</h4>
            <p>${contractType} de ${closestContract.fournisseur} expire dans ${daysUntil} jour${daysUntil > 1 ? 's' : ''} (${endDate.toLocaleDateString('fr-FR')})</p>
          </div>
        </div>
      `;
    }
  }
  
  // Afficher tous les contrats
  v.contracts.forEach(contract => {
    const typeIcon = contract.type === 'assurance' ? '🛡️' : '🔧';
    const dateDebut = new Date(contract.date_debut).toLocaleDateString('fr-FR');
    const dateFin = new Date(contract.date_fin).toLocaleDateString('fr-FR');
    const endDate = new Date(contract.date_fin);
    const daysUntil = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
    
    let alertBadge = '';
    if (daysUntil <= alertDays && daysUntil >= 0) {
      alertBadge = `<span class="stat-badge warning">⚠️ Expire dans ${daysUntil}j</span>`;
    } else if (daysUntil < 0) {
      alertBadge = '<span class="stat-badge warning" style="background: rgba(230, 57, 70, 0.2);">🚨 Expiré</span>';
    }
    
    list.innerHTML += `
      <div class="contract-item">
        <div class="contract-header">
          <div class="event-icon info">${typeIcon}</div>
          <div class="contract-details">
            <h4>${contract.type === 'assurance' ? 'Assurance' : 'Contrat d\'entretien'} - ${contract.fournisseur} ${alertBadge}</h4>
            <div class="contract-date">N° ${contract.numero}</div>
          </div>
        </div>
        <div class="contract-description">
          <strong>Période:</strong> ${dateDebut} → ${dateFin}<br>
          ${contract.description || ''}
        </div>
      </div>
    `;
  });
}

function populateVehicleRevisions() {
  const v = vehicles.find(ve => ve.id === currentVehicleId);
  if (!v) return;
  
  const alert = document.getElementById('next-revision-alert');
  const list = document.getElementById('revisions-list');
  
  alert.innerHTML = '';
  list.innerHTML = '';
  
  if (!v.revisions || v.revisions.length === 0) {
    list.innerHTML = '<div class="empty-state">🔧<br>Aucune révision enregistrée</div>';
    return;
  }
  
  const sorted = [...v.revisions].sort((a, b) => new Date(b.date) - new Date(a.date));
  const last = sorted[0];
  
  // Alerte basée sur la DATE de prochaine révision
  if (last.next_date) {
    const today = new Date();
    const nextDate = new Date(last.next_date);
    const daysUntil = Math.ceil((nextDate - today) / (1000 * 60 * 60 * 24));
    const alertDays = 30; // Alerte 30 jours avant
    
    if (daysUntil <= alertDays && daysUntil >= 0) {
      alert.innerHTML = `
        <div class="next-revision-alert">
          <div class="icon">⚠️</div>
          <div>
            <h4>Révision proche !</h4>
            <p>Prochaine révision dans ${daysUntil} jour${daysUntil > 1 ? 's' : ''} (${nextDate.toLocaleDateString('fr-FR')})</p>
          </div>
        </div>
      `;
    } else if (daysUntil < 0) {
      alert.innerHTML = `
        <div class="next-revision-alert" style="background: linear-gradient(135deg, var(--accent-red), #ff6b6b);">
          <div class="icon">🚨</div>
          <div>
            <h4>Révision dépassée !</h4>
            <p>La révision devait avoir lieu le ${nextDate.toLocaleDateString('fr-FR')}</p>
          </div>
        </div>
      `;
    }
  }
  
  sorted.forEach(revision => {
    const date = new Date(revision.date).toLocaleDateString('fr-FR');
    const nextDate = revision.next_date ? new Date(revision.next_date).toLocaleDateString('fr-FR') : 'Non définie';
    
    list.innerHTML += `
      <div class="revision-item">
        <div class="revision-header">
          <div class="event-icon entretien">🔧</div>
          <div class="revision-details">
            <h4>${revision.type}</h4>
            <div class="revision-date">${date} - ${revision.km.toLocaleString()} km</div>
          </div>
        </div>
        <div class="revision-notes">
          <strong>Prochaine révision prévue :</strong><br>
          📅 ${nextDate}<br><br>
          ${revision.notes || ''}
        </div>
      </div>
    `;
  });
}

function populateVehicleEvents() {
  const v = vehicles.find(ve => ve.id === currentVehicleId);
  if (!v) return;
  
  const list = document.getElementById('events-list');
  list.innerHTML = '';
  
  if (!v.events || v.events.length === 0) {
    list.innerHTML = '<div class="empty-state">📝<br>Aucun événement enregistré</div>';
    return;
  }
  
  // Trier du plus ancien au plus récent
  const sorted = [...v.events].sort((a, b) => new Date(a.date) - new Date(b.date));
  
  // Créer le conteneur de chat
  const chatContainer = document.createElement('div');
  chatContainer.className = 'chat-container';
  
  sorted.forEach(event => {
    const iconMap = { panne: '🔴', entretien: '🔧', info: 'ℹ️' };
    const typeMap = { panne: 'Panne', entretien: 'Entretien', info: 'Information' };
    const icon = iconMap[event.type] || 'ℹ️';
    const typeLabel = typeMap[event.type] || 'Info';
    
    // Formater la date avec heure si disponible
    const dateObj = new Date(event.date);
    const dateStr = dateObj.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
    const timeStr = dateObj.getHours() === 0 ? '' : dateObj.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const fullDate = timeStr ? `${dateStr} • ${timeStr}` : dateStr;
    
    // Obtenir les initiales de l'utilisateur
    const userName = event.user_name || 'Utilisateur inconnu';
    const initials = userName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.innerHTML = `
      <div class="avatar">${initials}</div>
      <div class="message-content">
        <div class="message-header">
          <span class="author-name">${userName}</span>
          <span class="message-date">${fullDate}</span>
        </div>
        <div class="bubble ${event.type}">
          <div class="event-type-badge ${event.type}">${icon} ${typeLabel}</div>
          <div class="event-title">${event.title}</div>
          <div class="event-description">${event.description || ''}</div>
        </div>
      </div>
    `;
    
    chatContainer.appendChild(bubble);
  });
  
  list.appendChild(chatContainer);
}

function closeVehicleModal() {
  document.getElementById('modal-backdrop').style.display = 'none';
  document.getElementById('modal-add-contract').style.display = 'none';
  document.getElementById('modal-add-revision').style.display = 'none';
  document.getElementById('modal-add-event').style.display = 'none';
}

function showAddContractModal() {
  document.getElementById('contract-type').value = 'assurance';
  document.getElementById('contract-fournisseur').value = '';
  document.getElementById('contract-numero').value = '';
  document.getElementById('contract-date-debut').value = '';
  document.getElementById('contract-date-fin').value = '';
  document.getElementById('contract-description').value = '';
  document.getElementById('modal-backdrop').style.display = 'block';
  document.getElementById('modal-add-contract').style.display = 'block';
}

async function saveContract() {
  const type = document.getElementById('contract-type').value;
  const fournisseur = document.getElementById('contract-fournisseur').value.trim();
  const numero = document.getElementById('contract-numero').value.trim();
  const date_debut = document.getElementById('contract-date-debut').value;
  const date_fin = document.getElementById('contract-date-fin').value;
  const description = document.getElementById('contract-description').value.trim();
  
  if (!fournisseur || !numero || !date_debut || !date_fin) {
    showToast('Remplis tous les champs', 'error');
    return;
  }
  
  const contract = {
    id_vehicule: currentVehicleId,
    type, fournisseur, numero, date_debut, date_fin, description
  };
  
  // Ajouter le spinner au bouton
  const saveBtn = document.querySelector('#modal-add-contract .btn-success');
  if (saveBtn) saveBtn.classList.add('btn-loading');
  
  showLoading(true);
  try {
    const url = `${API_URL}?action=addContract`;
    const result = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ contract })
    }).then(r => r.json());
    
    if (result.success) {
      await loadData();
      showToast('Contrat ajouté !', 'success');
      showVehicleDetail(currentVehicleId);
      switchVehicleTab('contracts');
      closeVehicleModal();
    } else {
      showToast(result.error || 'Erreur d\'ajout', 'error');
    }
  } catch (error) {
    showToast('Erreur de connexion', 'error');
  }
  if (saveBtn) saveBtn.classList.remove('btn-loading');
  showLoading(false);
}

function showAddRevisionModal() {
  document.getElementById('revision-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('revision-km').value = '';
  document.getElementById('revision-type').value = '';
  document.getElementById('revision-next-date').value = '';
  document.getElementById('revision-notes').value = '';
  document.getElementById('modal-backdrop').style.display = 'block';
  document.getElementById('modal-add-revision').style.display = 'block';
}

async function saveRevision() {
  const date = document.getElementById('revision-date').value;
  const km = parseInt(document.getElementById('revision-km').value);
  const type = document.getElementById('revision-type').value.trim();
  const next_date = document.getElementById('revision-next-date').value || null;
  const notes = document.getElementById('revision-notes').value.trim();
  
  if (!date || !km || !type) {
    showToast('Remplis les champs obligatoires', 'error');
    return;
  }
  
  const revision = {
    id_vehicule: currentVehicleId,
    date, km, type, next_date, notes
  };
  
  // Ajouter le spinner au bouton
  const saveBtn = document.querySelector('#modal-add-revision .btn-success');
  if (saveBtn) saveBtn.classList.add('btn-loading');
  
  showLoading(true);
  try {
    const url = `${API_URL}?action=addRevision`;
    const result = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ revision })
    }).then(r => r.json());
    
    if (result.success) {
      await loadData();
      showToast('Révision ajoutée !', 'success');
      showVehicleDetail(currentVehicleId);
      switchVehicleTab('revisions');
      closeVehicleModal();
    } else {
      showToast(result.error || 'Erreur d\'ajout', 'error');
    }
  } catch (error) {
    showToast('Erreur de connexion', 'error');
  }
  if (saveBtn) saveBtn.classList.remove('btn-loading');
  showLoading(false);
}

function showAddEventModal() {
  document.getElementById('event-type').value = 'info';
  document.getElementById('event-title').value = '';
  document.getElementById('event-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('event-description').value = '';
  document.getElementById('modal-backdrop').style.display = 'block';
  document.getElementById('modal-add-event').style.display = 'block';
}

async function saveEvent() {
  const type = document.getElementById('event-type').value;
  const title = document.getElementById('event-title').value.trim();
  const date = document.getElementById('event-date').value;
  const description = document.getElementById('event-description').value.trim();
  
  if (!title || !date) {
    showToast('Remplis les champs obligatoires', 'error');
    return;
  }
  
  const event = {
    id_vehicule: currentVehicleId,
    id_utilisateur: currentUser.id,  // Ajouter l'utilisateur connecté
    type, title, date, description
  };
  
  console.log('🔍 Debug saveEvent:', {
    currentUser: currentUser,
    id_utilisateur: currentUser.id,
    event: event
  });
  
  // Ajouter le spinner au bouton
  const saveBtn = document.querySelector('#modal-add-event .btn-success');
  if (saveBtn) saveBtn.classList.add('btn-loading');
  
  showLoading(true);
  try {
    const url = `${API_URL}?action=addEvent`;
    const result = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ event })
    }).then(r => r.json());
    
    if (result.success) {
      await loadData();
      showToast('Événement ajouté !', 'success');
      showVehicleDetail(currentVehicleId);
      switchVehicleTab('events');
      closeVehicleModal();
    } else {
      showToast(result.error || 'Erreur d\'ajout', 'error');
    }
  } catch (error) {
    showToast('Erreur de connexion', 'error');
  }
  if (saveBtn) saveBtn.classList.remove('btn-loading');
  showLoading(false);
}

/**
 * Charge les données du classement
 */
async function loadLeaderboard() {
  try {
    const response = await fetch(`${API_URL}?action=getLeaderboard`);
    const data = await response.json();
    leaderboardData = data;
    return data;
  } catch (error) {
    console.error('Erreur lors du chargement du classement:', error);
    return [];
  }
}

/**
 * Affiche le rang et la progression de l'utilisateur dans le header
 */
function displayUserRank() {
  if (!currentUser) return;
  
  const avatarCircle = document.getElementById('avatar-circle');
  const progressContainer = document.getElementById('progress-container');
  const progressLabel = document.getElementById('progress-label');
  const progressCount = document.getElementById('progress-count');
  const progressFill = document.getElementById('progress-fill');
  
  // Afficher la barre de progression
  progressContainer.style.display = 'block';
  
  // Mettre à jour le contenu
  if (currentUser.rank) {
    // Mettre à jour l'emoji de l'avatar
    avatarCircle.textContent = currentUser.rank.emoji;
    
    // Mettre à jour le label du rang
    progressLabel.textContent = currentUser.rank.name;
    
    // Mettre à jour la progression
    progressFill.style.width = `${currentUser.rank.progress}%`;
    
    // Texte de progression
    const currentOps = currentUser.total_operations || 0;
    if (currentUser.rank.max === 999999) {
      // Niveau maximum - Badge et barre dorés
      progressCount.textContent = 'Niveau max ! 🎉';
      avatarCircle.style.background = 'linear-gradient(135deg, #ffd700 0%, #ffed4e 100%)';
      avatarCircle.style.boxShadow = '0 4px 16px rgba(255, 215, 0, 0.5)';
      progressFill.style.background = 'linear-gradient(90deg, #ffd700 0%, #ffed4e 100%)';
      progressFill.style.boxShadow = '0 0 12px rgba(255, 215, 0, 0.6)';
    } else {
      // Niveau normal
      progressCount.textContent = `${currentOps}/${currentUser.rank.max}`;
      avatarCircle.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
      avatarCircle.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)';
      progressFill.style.background = 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)';
      progressFill.style.boxShadow = '0 0 8px rgba(102, 126, 234, 0.5)';
    }
  }
}

/**
 * Affiche la page de classement
 */
async function showLeaderboard() {
  showLoading(true);
  
  try {
    const data = await loadLeaderboard();
    
    // Afficher le podium (top 3)
    for (let i = 1; i <= 3; i++) {
      const podiumPlace = document.getElementById(`podium-${i}`);
      if (data[i - 1]) {
        const user = data[i - 1];
        podiumPlace.querySelector('.podium-name').textContent = user.nom.split(' ')[0];
        podiumPlace.querySelector('.podium-rank-title').textContent = user.rank.name;
        podiumPlace.querySelector('.podium-ops').textContent = `${user.total_operations} ops`;
      } else {
        podiumPlace.querySelector('.podium-name').textContent = '-';
        podiumPlace.querySelector('.podium-rank-title').textContent = '-';
        podiumPlace.querySelector('.podium-ops').textContent = '0 ops';
      }
    }
    
    // Afficher la liste complète (à partir du 4ème)
    const leaderboardList = document.getElementById('leaderboard-list');
    leaderboardList.innerHTML = '';
    
    data.slice(3).forEach(user => {
      const item = document.createElement('div');
      item.className = 'leaderboard-item';
      
      // Marquer l'utilisateur courant
      if (currentUser && user.id === currentUser.id) {
        item.classList.add('current-user');
      }
      
      // Afficher les badges
      let badgesHTML = '';
      if (user.badges && user.badges.length > 0) {
        badgesHTML = '<div class="leaderboard-user-badges">';
        user.badges.forEach(badge => {
          const badgeText = typeof badge === 'string' ? badge : `${badge.emoji} ${badge.name}`;
          badgesHTML += `
            <div class="leaderboard-badge">
              <span>${badgeText.split(' ')[0]}</span>
              <span>${badgeText.split(' ').slice(1).join(' ')}</span>
            </div>
          `;
        });
        badgesHTML += '</div>';
      }
      
      item.innerHTML = `
        <div class="leaderboard-position">${user.position}</div>
        <div class="leaderboard-rank-emoji">${user.rank.emoji}</div>
        <div class="leaderboard-user-info">
          <div class="leaderboard-user-name">${user.nom}</div>
          <div class="leaderboard-user-rank">${user.rank.name}</div>
          ${badgesHTML}
        </div>
        <div class="leaderboard-ops">
          ${user.total_operations}
          <span class="leaderboard-ops-label">ops</span>
        </div>
      `;
      
      leaderboardList.appendChild(item);
    });
    
    goToScreen('screen-leaderboard');
  } catch (error) {
    console.error('Erreur lors de l\'affichage du classement:', error);
    showToast('Erreur lors du chargement du classement', 'error');
  }
  
  showLoading(false);
}