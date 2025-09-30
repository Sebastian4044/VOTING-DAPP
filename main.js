import { ethers } from 'ethers';
import confetti from 'canvas-confetti';

// Default contract address (you can change it from the UI "Contract settings")
const CONTRACT_ADDRESS_DEFAULT = '0x3Ad253403a6edEcb0B331de1b8097ad5cF33B9C8';

// Sepolia guard
const EXPECTED_CHAIN_ID = 11155111;
const ADD_CHAIN_PARAMS = {
  chainId: '0xaa36a7',
  chainName: 'Sepolia',
  nativeCurrency: { name: 'SepoliaETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://rpc.sepolia.org'],
  blockExplorerUrls: ['https://sepolia.etherscan.io/']
};

// ABI (from your contract)
const ABI = [
  { inputs: [], stateMutability: 'nonpayable', type: 'constructor' },
  { anonymous: false, inputs: [{ indexed: true, internalType: 'address', name: 'voter', type: 'address' }, { indexed: false, internalType: 'uint256', name: 'candidate', type: 'uint256' }], name: 'voted', type: 'event' },
  { anonymous: false, inputs: [{ indexed: false, internalType: 'uint256', name: 'id', type: 'uint256' }, { indexed: false, internalType: 'string', name: 'name', type: 'string' }], name: 'candidateAdded', type: 'event' },
  { anonymous: false, inputs: [], name: 'VotingReset', type: 'event' },
  { inputs: [], name: 'admin', outputs: [{ internalType: 'address', name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'votingActive', outputs: [{ internalType: 'bool', name: '', type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], name: 'candidates', outputs: [{ internalType: 'uint256', name: 'id', type: 'uint256' }, { internalType: 'string', name: 'name', type: 'string' }, { internalType: 'uint256', name: 'voteCount', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'candidatesCount', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'address', name: '', type: 'address' }], name: 'hasvoted', outputs: [{ internalType: 'bool', name: '', type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'string', name: '_name', type: 'string' }], name: 'addCandidate', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: '_candidateId', type: 'uint256' }], name: 'vote', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: '_candidateId', type: 'uint256' }], name: 'getResults', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'resetVoting', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ internalType: 'bool', name: '_status', type: 'bool' }], name: 'toggleVoting', outputs: [], stateMutability: 'nonpayable', type: 'function' }
];

// State
let provider, signer, contract, adminAddr, myAddr;
let isAdmin = false;
let votingActive = false;
let listenerBound = false;

// DOM
const $ = (id) => document.getElementById(id);
const statusPill = $('statusPill');
const networkPill = $('networkPill');
const adminPill = $('adminPill');
const addrPill = $('addrPill');
const candCountPill = $('candCountPill');
const activePill = $('activePill');
const resultsEl = $('results');
const feedEl = $('feed');
const btnConnect = $('btnConnect');
const btnRefresh = $('btnRefresh');
const btnAddCand = $('btnAddCand');
const btnToggle = $('btnToggle');
const btnReset = $('btnReset');
const newCandName = $('newCandName');
const toast = $('toast');
const contractAddrSpan = $('contractAddr');
const addrInput = $('addrInput');
const btnSetAddr = $('btnSetAddr');

// Utils
const short = (a) => (a ? a.slice(0, 6) + '...' + a.slice(-4) : '');
const getStoredAddr = () => localStorage.getItem('votingContract') || CONTRACT_ADDRESS_DEFAULT;
const setStoredAddr = (a) => localStorage.setItem('votingContract', a);

function getInjected() {
  const eth = window.ethereum;
  if (!eth) return null;
  if (Array.isArray(eth.providers) && eth.providers.length) {
    const mm = eth.providers.find((p) => p.isMetaMask);
    return mm || eth.providers[0];
  }
  return eth;
}

function setConnectButton(isConnected) {
  if (!btnConnect) return;
  if (isConnected) {
    btnConnect.textContent = 'Connected';
    btnConnect.classList.add('connected');
    btnConnect.disabled = true; // disable when connected
  } else {
    btnConnect.textContent = 'Connect Wallet';
    btnConnect.classList.remove('connected');
    btnConnect.disabled = false;
  }
}

function showToast(msg, type = 'info') {
  toast.style.display = 'block';
  toast.style.borderColor = type === 'bad' ? '#ff8484' : type === 'good' ? '#5be4a6' : '#2a3557';
  toast.innerHTML = msg;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (toast.style.display = 'none'), 4000);
}

function confettiBurst() {
  confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
}

async function ensureContractExists() {
  try {
    const code = await provider.getCode(contract.target);
    return code && code !== '0x';
  } catch {
    return false;
  }
}

// Boot (read-only so users can see results)
initReadOnly();

// Wire UI
btnConnect?.addEventListener('click', connect);
btnRefresh?.addEventListener('click', loadAll);
btnAddCand?.addEventListener('click', addCandidate);
btnToggle?.addEventListener('click', toggleVoting);
btnReset?.addEventListener('click', resetVoting);
btnSetAddr?.addEventListener('click', () => {
  const addr = addrInput.value.trim();
  if (!ethers.isAddress(addr)) return showToast('Enter a valid 0x address', 'bad');
  setStoredAddr(addr);
  showToast('Contract address saved. Reloading…');
  setTimeout(() => window.location.reload(), 600);
});

async function initReadOnly() {
  const injected = getInjected();
  if (!injected) {
    statusPill.textContent = 'No wallet';
    statusPill.className = 'pill bad';
    setConnectButton(false);
    return;
  }
  provider = new ethers.BrowserProvider(injected);
  contract = new ethers.Contract(getStoredAddr(), ABI, provider);
  contractAddrSpan.textContent = contract.target;
  addrInput.value = contract.target;

  const net = await provider.getNetwork();
  networkPill.textContent = `${net.name} • chainId ${Number(net.chainId)}`;
  statusPill.textContent = 'Ready (read-only)';
  statusPill.className = 'pill';
  setConnectButton(false);
  await loadAll();
  bindEvents();
}

// Robust connect that always triggers MetaMask
async function connect() {
  const injected = getInjected();
  if (!injected) { showToast('Install MetaMask extension and reload', 'bad'); setConnectButton(false); return; }

  btnConnect.disabled = true;
  try {
    // 1) Request accounts first → forces MetaMask popup
    const accounts = await injected.request({ method: 'eth_requestAccounts' });
    if (!accounts || accounts.length === 0) throw new Error('No account returned');

    // 2) Provider/signer
    provider = new ethers.BrowserProvider(injected, 'any');
    signer = await provider.getSigner();
    myAddr = await signer.getAddress();

    // 3) Switch to Sepolia after connection
    const requiredHex = '0x' + EXPECTED_CHAIN_ID.toString(16);
    const currentHex = await injected.request({ method: 'eth_chainId' });
    if (currentHex.toLowerCase() !== requiredHex.toLowerCase()) {
      try {
        await injected.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: requiredHex }] });
      } catch (e) {
        if (e?.code === 4902) {
          await injected.request({ method: 'wallet_addEthereumChain', params: [ADD_CHAIN_PARAMS] });
        } else {
          throw e;
        }
      }
    }

    // 4) Init contract and UI
    contract = new ethers.Contract(getStoredAddr(), ABI, signer);
    const net = await provider.getNetwork();
    networkPill.textContent = `${net.name} • chainId ${Number(net.chainId)}`;
    addrPill.textContent = short(myAddr);
    statusPill.textContent = 'Connected';
    statusPill.className = 'pill good';

    setConnectButton(true);
    await loadAll();
    bindEvents();
    attachWalletListeners(injected);
  } catch (e) {
    setConnectButton(false);
    if (e?.code === -32002) showToast('MetaMask request pending — click the MetaMask icon and approve.', 'warn');
    else if (e?.code === 4001) showToast('Request rejected in MetaMask.', 'bad');
    else showToast(e?.shortMessage || e?.message || String(e), 'bad');
    console.error('connect error:', e);
  } finally {
    if (!btnConnect.classList.contains('connected')) btnConnect.disabled = false;
  }
}

function attachWalletListeners(injected) {
  injected.removeListener?.('accountsChanged', onAccountsChanged);
  injected.removeListener?.('chainChanged', onChainChanged);
  injected.on('accountsChanged', onAccountsChanged);
  injected.on('chainChanged', onChainChanged);
}
async function onAccountsChanged(accts) {
  if (!accts || accts.length === 0) {
    statusPill.textContent = 'Disconnected';
    statusPill.className = 'pill';
    addrPill.textContent = '—';
    signer = undefined;
    setConnectButton(false);
    return;
  }
  await connect(); // will set button to Connected ✅
}
function onChainChanged() {
  window.location.reload();
}

async function loadAll() {
  if (!contract) return;
  if (!(await ensureContractExists())) {
    resultsEl.innerHTML = `<div class="card" style="grid-column: 1/-1;"><div class="warn-banner">No contract code found at <span class="mono">${contract.target}</span> on this network.</div></div>`;
    return;
  }

  const [adminRes, activeRes, countRes] = await Promise.all([
    contract.admin(),
    contract.votingActive(),
    contract.candidatesCount()
  ]);
  adminAddr = adminRes;
  votingActive = Boolean(activeRes);
  const cnt = Number(countRes);

  const amAdmin = signer && myAddr && adminAddr && myAddr.toLowerCase() === adminAddr.toLowerCase();
  isAdmin = Boolean(amAdmin);
  adminPill.textContent = isAdmin ? 'Admin' : 'User';
  adminPill.className = 'pill ' + (isAdmin ? 'good' : '');
  activePill.textContent = votingActive ? 'Voting active' : 'Voting paused';
  activePill.className = 'pill ' + (votingActive ? 'good' : 'bad');
  candCountPill.textContent = `${cnt} candidate${cnt === 1 ? '' : 's'}`;

  const ids = Array.from({ length: cnt }, (_, i) => i + 1);
  const candStructs = await Promise.all(ids.map((i) => contract.candidates(i)));
  const candidates = candStructs.map((c) => ({
    id: Number(c.id ?? c[0]),
    name: String(c.name ?? c[1]),
    voteCount: Number(c.voteCount ?? c[2])
  }));
  const totalVotes = candidates.reduce((a, b) => a + b.voteCount, 0);

  renderCandidates(candidates, totalVotes);

  if (signer && myAddr) {
    try {
      const hv = await contract.hasvoted(myAddr);
      if (hv) showToast('You have already voted in this round.', 'warn');
    } catch {}
  }
}

function renderCandidates(cands, totalVotes) {
  if (cands.length === 0) {
    resultsEl.innerHTML = `<div class="card" style="grid-column: 1/-1;">
      <h3>No candidates yet</h3>
      <div class="muted">Admin can add candidates in the panel.</div>
    </div>`;
    return;
  }
  const sorted = [...cands].sort((a, b) => b.voteCount - a.voteCount || a.id - b.id);
  resultsEl.innerHTML = '';
  sorted.forEach((c) => {
    const pct = totalVotes ? Math.round((c.voteCount / totalVotes) * 100) : 0;
    const card = document.createElement('div');
    card.className = 'candidate';
    card.innerHTML = `
      <div class="cand-id">${c.id}</div>
      <div>
        <div class="row space">
          <div><strong>${escapeHtml(c.name)}</strong> <span class="muted">#${c.id}</span></div>
          <div class="mono">${c.voteCount} vote${c.voteCount === 1 ? '' : 's'} • ${pct}%</div>
        </div>
        <div class="bar" style="margin-top:8px;"><span style="width:${pct}%"></span></div>
      </div>
      <div><button class="btn voteBtn" data-id="${c.id}">Vote</button></div>
    `;
    resultsEl.appendChild(card);
  });

  document.querySelectorAll('.voteBtn').forEach((btn) => {
    btn.addEventListener('click', onVoteClick);
    if (!votingActive || !signer) btn.setAttribute('disabled', '');
  });
}

async function onVoteClick(e) {
  const id = Number(e.currentTarget.dataset.id);
  if (!signer) return showToast('Connect your wallet to vote', 'bad');
  try {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = 'Sending...';
    const tx = await contract.vote(id);
    showToast('Transaction sent. Waiting for confirmation…');
    await tx.wait();
    e.currentTarget.textContent = 'Voted ✅';
    confettiBurst();
    await loadAll();
  } catch (err) {
    console.error(err);
    e.currentTarget.disabled = false;
    e.currentTarget.textContent = 'Vote';
    showToast(err?.shortMessage || err?.message || String(err), 'bad');
  }
}

function appendFeed(text) {
  const li = document.createElement('li');
  li.innerHTML = text;
  feedEl.prepend(li);
  while (feedEl.children.length > 12) feedEl.removeChild(feedEl.lastChild);
}

function bindEvents() {
  if (!contract || listenerBound) return;
  listenerBound = true;
  try { contract.removeAllListeners(); } catch {}
  contract.on('voted', async (voter, candidate) => {
    const cid = Number(candidate);
    let cname = '';
    try { const c = await contract.candidates(cid); cname = c.name ?? c[1]; } catch {}
    appendFeed(`🗳️ <span class="mono">${short(voter)}</span> voted for <strong>${escapeHtml(cname || ('#' + cid))}</strong>`);
    loadAll();
  });
  contract.on('candidateAdded', (id, name) => {
    appendFeed(`➕ Candidate added: <strong>${escapeHtml(name)}</strong> (#${Number(id)})`);
    loadAll();
  });
  contract.on('VotingReset', () => {
    appendFeed('♻️ Voting was reset by admin');
    loadAll();
  });
}

async function addCandidate() {
  if (!isAdmin) return showToast('Admin only', 'bad');
  const name = (newCandName.value || '').trim();
  if (!name) return showToast('Enter a candidate name', 'bad');
  try {
    const tx = await contract.addCandidate(name);
    showToast('Adding candidate…');
    await tx.wait();
    newCandName.value = '';
    showToast('Candidate added', 'good');
    loadAll();
  } catch (e) {
    console.error(e);
    showToast(e?.shortMessage || e?.message || String(e), 'bad');
  }
}

async function toggleVoting() {
  if (!isAdmin) return showToast('Admin only', 'bad');
  try {
    const next = !votingActive;
    const tx = await contract.toggleVoting(next);
    showToast(`Turning voting ${next ? 'ON' : 'OFF'}…`);
    await tx.wait();
    showToast('Voting status updated', 'good');
    loadAll();
  } catch (e) {
    console.error(e);
    showToast(e?.shortMessage || e?.message || String(e), 'bad');
  }
}

async function resetVoting() {
  if (!isAdmin) return showToast('Admin only', 'bad');
  const yes = confirm('Reset will set all vote counts to 0.\nNOTE: In this contract, hasvoted is NOT cleared, so addresses that voted cannot vote again.\nContinue?');
  if (!yes) return;
  try {
    const tx = await contract.resetVoting();
    showToast('Resetting…');
    await tx.wait();
    showToast('Voting reset', 'good');
    loadAll();
  } catch (e) {
    console.error(e);
    showToast(e?.shortMessage || e?.message || String(e), 'bad');
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}