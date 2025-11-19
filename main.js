// Buffer polyfill for WalletConnect
import { Buffer } from 'buffer';
window.Buffer = Buffer;
window.global = window.global || window;
window.process = window.process || { env: {} };

import {
  createConfig,
  connect,
  getAccount,
  watchAccount,
  writeContract,
  readContract,
  waitForTransactionReceipt,
  http
} from '@wagmi/core';
import { celo } from '@wagmi/core/chains';
import { createAppKit } from '@reown/appkit';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import confetti from 'canvas-confetti';

// Configuration
const PROJECT_ID = 'e0dd881bad824ac3418617434a79f917';

// DOM Elements
const connectBtn = document.getElementById('connectBtn');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const tapBtn = document.getElementById('tapBtn');
const statusBox = document.getElementById('statusBox');
const walletAddress = document.getElementById('walletAddress');
const actionButtons = document.getElementById('actionButtons');
const sessionTimer = document.getElementById('sessionTimer');
const timerDisplay = document.getElementById('timerDisplay');
const currentTapsEl = document.getElementById('currentTaps');
const potentialRewardEl = document.getElementById('potentialReward');
const totalClaimedEl = document.getElementById('totalClaimed');
const rewardPerTapEl = document.getElementById('rewardPerTap');
const tapCountEl = document.getElementById('tapCount');

// State
let contractDetails = null;
let userAddress = null;
let wagmiConfig = null;
let modal = null;
let sessionActive = false;
let tapCount = 0;
let sessionStartTime = null;
let timerInterval = null;
let rewardPerTap = 0.001;

// Load contract details
async function loadContract() {
  try {
    const response = await fetch('./contract.json');
    if (!response.ok) throw new Error('Failed to load contract');
    contractDetails = await response.json();
    console.log('Contract loaded:', contractDetails.address);
    return true;
  } catch (e) {
    console.error('Contract load error:', e);
    setStatus('Failed to load contract details', 'error');
    return false;
  }
}

// Initialize Wagmi
const wagmiAdapter = new WagmiAdapter({
  networks: [celo],
  projectId: PROJECT_ID,
  ssr: false
});

wagmiConfig = wagmiAdapter.wagmiConfig;

// Create AppKit Modal
modal = createAppKit({
  adapters: [wagmiAdapter],
  networks: [celo],
  projectId: PROJECT_ID,
  metadata: {
    name: 'Tap to Earn',
    description: 'Tap to earn tokens on Celo!',
    url: window.location.origin,
    icons: ['https://assets-global.website-files.com/64b589417d470659a8508e6e/65f97cc1c34a2608c704259b_celo.png']
  },
  features: {
    analytics: true,
  },
  themeMode: 'dark',
  themeVariables: {
    '--w3m-accent': '#49dfb5',
  }
});

// Status Helper
function setStatus(msg, type = 'info') {
  statusBox.className = `status-box status-${type}`;
  const icons = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' };
  statusBox.textContent = `${icons[type] || ''} ${msg}`;
}

// Format Number Helper
function formatNumber(num, decimals = 3) {
  return Number(num).toFixed(decimals);
}

// Update Stats
async function updateStats() {
  if (!contractDetails || !userAddress) return;

  try {
    // Get reward per tap
    const rewardWei = await readContract(wagmiConfig, {
      address: contractDetails.address,
      abi: contractDetails.abi,
      functionName: 'rewardPerTap'
    });
    rewardPerTap = Number(rewardWei) / 1e18;
    rewardPerTapEl.textContent = formatNumber(rewardPerTap, 4);

    // Get total claimed
    const claimed = await readContract(wagmiConfig, {
      address: contractDetails.address,
      abi: contractDetails.abi,
      functionName: 'totalClaimed',
      args: [userAddress]
    });
    const claimedTokens = Number(claimed) / 1e18;
    totalClaimedEl.textContent = formatNumber(claimedTokens);

    // Update potential reward
    const potential = tapCount * rewardPerTap;
    potentialRewardEl.textContent = formatNumber(potential);

  } catch (e) {
    console.error('Failed to update stats:', e);
  }
}

// Start Session
async function startSession() {
  if (!contractDetails || !userAddress) return;

  try {
    setStatus('Starting session...', 'info');
    startBtn.disabled = true;

    const hash = await writeContract(wagmiConfig, {
      address: contractDetails.address,
      abi: contractDetails.abi,
      functionName: 'startSession'
    });

    setStatus('Confirming transaction...', 'info');
    await waitForTransactionReceipt(wagmiConfig, { hash });

    sessionActive = true;
    tapCount = 0;
    sessionStartTime = Date.now();

    // Enable tapping
    tapBtn.disabled = false;
    tapBtn.classList.remove('disabled');
    stopBtn.disabled = false;
    startBtn.disabled = true;

    // Start timer
    sessionTimer.classList.remove('hidden');
    startTimer();

    setStatus('Session started! Start tapping! 🎯', 'success');
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 }
    });

  } catch (e) {
    console.error('Start session error:', e);
    setStatus(e.message || 'Failed to start session', 'error');
    startBtn.disabled = false;
  }
}

// Stop Session & Claim
async function stopAndClaim() {
  if (!contractDetails || !userAddress || !sessionActive) return;

  try {
    setStatus('Claiming rewards...', 'info');
    stopBtn.disabled = true;
    tapBtn.disabled = true;
    tapBtn.classList.add('disabled');

    // Stop timer
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    const hash = await writeContract(wagmiConfig, {
      address: contractDetails.address,
      abi: contractDetails.abi,
      functionName: 'claim',
      args: [BigInt(tapCount)]
    });

    setStatus('Confirming claim...', 'info');
    const receipt = await waitForTransactionReceipt(wagmiConfig, { hash });

    if (receipt.status === 'success') {
      const reward = tapCount * rewardPerTap;
      setStatus(`🎉 Claimed ${formatNumber(reward)} tokens!`, 'success');

      // Epic confetti
      confetti({
        particleCount: 200,
        spread: 100,
        origin: { y: 0.6 },
        colors: ['#49dfb5', '#7dd3fc', '#fbbf24']
      });

      // Reset state
      sessionActive = false;
      tapCount = 0;
      currentTapsEl.textContent = '0';
      tapCountEl.textContent = '0';
      sessionTimer.classList.add('hidden');

      startBtn.disabled = false;
      stopBtn.disabled = true;

      // Update stats
      await updateStats();
    }

  } catch (e) {
    console.error('Claim error:', e);
    setStatus(e.message || 'Failed to claim rewards', 'error');
    stopBtn.disabled = false;
    tapBtn.disabled = false;
    tapBtn.classList.remove('disabled');
  }
}

// Handle Tap
function handleTap(event) {
  if (!sessionActive || tapBtn.disabled) return;

  tapCount++;
  currentTapsEl.textContent = tapCount;
  tapCountEl.textContent = tapCount;

  // Update potential reward
  const potential = tapCount * rewardPerTap;
  potentialRewardEl.textContent = formatNumber(potential);

  // Ripple effect
  createRipple(event);

  // Floating point
  createFloatingPoint(event);

  // Haptic feedback (mobile)
  if (navigator.vibrate) {
    navigator.vibrate(10);
  }
}

// Create Ripple Effect
function createRipple(event) {
  const button = event.currentTarget;
  const ripple = document.createElement('span');
  const rect = button.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const x = event.clientX - rect.left - size / 2;
  const y = event.clientY - rect.top - size / 2;

  ripple.className = 'ripple';
  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${x}px`;
  ripple.style.top = `${y}px`;

  button.appendChild(ripple);

  setTimeout(() => ripple.remove(), 600);
}

// Create Floating Point
function createFloatingPoint(event) {
  const point = document.createElement('div');
  point.className = 'floating-point';
  point.textContent = `+${formatNumber(rewardPerTap, 4)}`;
  
  const rect = tapBtn.getBoundingClientRect();
  point.style.left = `${event.clientX}px`;
  point.style.top = `${event.clientY}px`;
  point.style.position = 'fixed';

  document.body.appendChild(point);

  setTimeout(() => point.remove(), 1000);
}

// Start Timer
function startTimer() {
  timerInterval = setInterval(() => {
    if (!sessionStartTime) return;

    const elapsed = Date.now() - sessionStartTime;
    const seconds = Math.floor(elapsed / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;

    timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    // Auto-stop at 5 minutes (300 seconds)
    if (seconds >= 300) {
      setStatus('Maximum session time reached! Please claim.', 'warning');
      tapBtn.disabled = true;
      tapBtn.classList.add('disabled');
      clearInterval(timerInterval);
    }
  }, 1000);
}

// Create Background Particles
function createParticles() {
  const particlesContainer = document.getElementById('particles');
  for (let i = 0; i < 20; i++) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    particle.style.left = `${Math.random() * 100}%`;
    particle.style.animationDelay = `${Math.random() * 20}s`;
    particle.style.animationDuration = `${15 + Math.random() * 10}s`;
    particlesContainer.appendChild(particle);
  }
}

// Event Listeners
connectBtn.addEventListener('click', () => {
  if (modal) modal.open();
});

startBtn.addEventListener('click', startSession);
stopBtn.addEventListener('click', stopAndClaim);
tapBtn.addEventListener('click', handleTap);

// Watch Account
watchAccount(wagmiConfig, {
  onChange(account) {
    if (account.address && account.isConnected) {
      userAddress = account.address;
      const shortAddr = `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
      
      walletAddress.textContent = `Connected: ${shortAddr}`;
      walletAddress.classList.remove('hidden');
      walletAddress.onclick = () => modal.open();
      
      connectBtn.classList.add('hidden');
      actionButtons.classList.remove('hidden');
      
      setStatus('Wallet connected! Click "Start Session" to begin.', 'success');
      updateStats();
      
    } else {
      userAddress = null;
      walletAddress.classList.add('hidden');
      connectBtn.classList.remove('hidden');
      actionButtons.classList.add('hidden');
      setStatus('Connect your wallet to start tapping!', 'info');
    }
  }
});

// Initialize
(async () => {
  const loaded = await loadContract();
  if (loaded) {
    const currentAccount = getAccount(wagmiConfig);
    if (currentAccount.isConnected && currentAccount.address) {
      userAddress = currentAccount.address;
      const shortAddr = `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
      walletAddress.textContent = `Connected: ${shortAddr}`;
      walletAddress.classList.remove('hidden');
      connectBtn.classList.add('hidden');
      actionButtons.classList.remove('hidden');
      setStatus('Wallet connected! Click "Start Session" to begin.', 'success');
      await updateStats();
    }
  }
  
  createParticles();
})();