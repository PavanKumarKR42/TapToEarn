// Buffer polyfill for WalletConnect
import { Buffer } from 'buffer';
window.Buffer = Buffer;
window.global = window.global || window;
window.process = window.process || { env: {} };

import { sdk } from '@farcaster/miniapp-sdk';
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
import { base } from '@wagmi/core/chains';
import { farcasterMiniApp } from '@farcaster/miniapp-wagmi-connector';
import { createAppKit } from '@reown/appkit';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import confetti from 'canvas-confetti';

// Configuration
const PROJECT_ID = '038aaf03f1ff1d3e5a13b983631ec5ea';
const MINIAPP_URL = window.location.origin;

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
let rewardPerTap = 0.001; // Fixed reward per tap
let isFarcasterEnvironment = false;
let lastClaimAmount = 0;

// Farcaster Detection
async function isFarcasterEmbed() {
  return Promise.race([
    (async () => {
      const isIframe = window.self !== window.top;
      const hasSDK = typeof sdk !== 'undefined';
      
      if (!isIframe || !hasSDK) return false;
      
      await new Promise(resolve => setTimeout(resolve, 100));
      const isSdkReady = sdk.context !== undefined && sdk.context !== null;
      
      console.log('Farcaster Detection:', {
        isIframe,
        hasSDK,
        isSdkReady,
        hasValidContext: hasSDK && sdk.context?.user?.fid !== undefined
      });
      
      return isIframe && hasSDK && isSdkReady;
    })(),
    new Promise(resolve => setTimeout(() => resolve(false), 500))
  ]);
}

// Initialize Farcaster SDK
async function initializeFarcasterSDK() {
  try {
    console.log('Initializing Farcaster SDK...');
    await sdk.actions.ready({ disableNativeGestures: true });
    console.log('✅ Farcaster SDK ready');
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const hasPromptedAddApp = localStorage.getItem('hasPromptedAddApp');
    if (!hasPromptedAddApp && sdk?.actions?.addMiniApp) {
      try {
        await sdk.actions.addMiniApp();
        localStorage.setItem('hasPromptedAddApp', 'true');
        console.log('✅ Add mini app prompt shown');
      } catch (e) {
        console.log('User declined add mini app');
      }
    }
    
    return true;
  } catch (e) {
    console.log('Farcaster SDK initialization failed:', e);
    return false;
  }
}

// Load Contract
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

// Status Helper
function setStatus(msg, type = 'info') {
  statusBox.className = `status-box status-${type}`;
  const icons = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' };
  statusBox.textContent = `${icons[type] || ''} ${msg}`;
}

// Format Number
function formatNumber(num, decimals = 3) {
  return Number(num).toFixed(decimals);
}

// Update Stats
async function updateStats() {
  if (!contractDetails || !userAddress || !wagmiConfig) return;

  try {
    // Get token address
    const tokenAddress = await readContract(wagmiConfig, {
      address: contractDetails.address,
      abi: contractDetails.abi,
      functionName: 'token'
    });
    
    console.log('Token address:', tokenAddress);
    
    // Update potential reward
    const potential = tapCount * rewardPerTap;
    potentialRewardEl.textContent = formatNumber(potential);

    // Note: totalClaimed would require tracking via events or off-chain storage
    // For now, we'll keep it as is or use localStorage
    const storedClaimed = localStorage.getItem(`totalClaimed_${userAddress}`) || '0';
    totalClaimedEl.textContent = formatNumber(parseFloat(storedClaimed));

  } catch (e) {
    console.error('Failed to update stats:', e);
  }
}

// Start Session (Client-side only - no contract call)
function startSession() {
  if (!userAddress) return;

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
}

// Stop Session & Claim
async function stopAndClaim() {
  if (!contractDetails || !userAddress || !sessionActive) return;
  
  if (tapCount === 0) {
    setStatus('You need to tap at least once!', 'warning');
    return;
  }

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

    // Call claim function with tap count
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
      lastClaimAmount = reward;
      
      // Update localStorage total
      const currentTotal = parseFloat(localStorage.getItem(`totalClaimed_${userAddress}`) || '0');
      const newTotal = currentTotal + reward;
      localStorage.setItem(`totalClaimed_${userAddress}`, newTotal.toString());
      
      setStatus(`🎉 Claimed ${formatNumber(reward)} tokens from ${tapCount} taps!`, 'success');

      // Epic confetti
      confetti({
        particleCount: 200,
        spread: 100,
        origin: { y: 0.6 },
        colors: ['#0052FF', '#5B8DEF', '#fbbf24']
      });

      // Cast to Farcaster if in miniapp
      if (isFarcasterEnvironment) {
        setTimeout(() => {
          promptCastShare(tapCount, reward);
        }, 2000);
      }

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
    setStatus(getErrorMessage(e), 'error');
    stopBtn.disabled = false;
    tapBtn.disabled = false;
    tapBtn.classList.remove('disabled');
    if (sessionActive) {
      startTimer();
    }
  }
}

// Prompt Cast Share (Farcaster)
async function promptCastShare(taps, reward) {
  if (!isFarcasterEnvironment || !sdk?.actions?.composeCast) return;

  const text = `I just earned ${formatNumber(reward)} tokens by tapping ${taps} times! 💎⚡\n\nTap to earn on Base:`;
  const embedUrl = MINIAPP_URL;

  try {
    const result = await sdk.actions.composeCast({
      text: text,
      embeds: [embedUrl]
    });

    if (result?.cast) {
      console.log('✅ Cast shared:', result.cast.hash);
      setStatus('🎉 Shared to Farcaster!', 'success');
    }
  } catch (e) {
    console.log('Cast cancelled or failed:', e);
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

  // Effects
  createRipple(event);
  createFloatingPoint(event);

  // Haptic feedback
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
  
  point.style.left = `${event.clientX}px`;
  point.style.top = `${event.clientY}px`;
  point.style.position = 'fixed';

  document.body.appendChild(point);
  setTimeout(() => point.remove(), 1000);
}

// Start Timer
function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  
  timerInterval = setInterval(() => {
    if (!sessionStartTime) return;

    const elapsed = Date.now() - sessionStartTime;
    const seconds = Math.floor(elapsed / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;

    timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    // Auto-stop at 5 minutes (300 seconds)
    if (seconds >= 300) {
      setStatus('⏰ Maximum session time reached! Please claim.', 'warning');
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

// Error Message Helper
function getErrorMessage(error) {
  const msg = error.message || error.shortMessage || '';
  
  if (msg.includes('insufficient funds') || msg.includes('insufficient balance')) {
    return 'Insufficient funds for gas fees';
  } else if (msg.includes('User rejected') || msg.includes('user rejected')) {
    return 'Transaction rejected';
  } else if (msg.includes('Insufficient contract balance')) {
    return 'Contract has insufficient token balance';
  }
  
  return error.shortMessage || 'Transaction failed';
}

// Initialize Wagmi
const wagmiAdapter = new WagmiAdapter({
  networks: [base],
  projectId: PROJECT_ID,
  ssr: false
});

wagmiConfig = wagmiAdapter.wagmiConfig;

// Create AppKit Modal
modal = createAppKit({
  adapters: [wagmiAdapter],
  networks: [base],
  projectId: PROJECT_ID,
  metadata: {
    name: 'Tap to Earn',
    description: 'Tap to earn tokens on Base!',
    url: MINIAPP_URL,
    icons: [`${MINIAPP_URL}/icon.png`]
  },
  features: {
    analytics: true,
    connectMethodsOrder: ["wallet"],
  },
  allWallets: 'SHOW',
  themeMode: 'dark',
  themeVariables: {
    '--w3m-accent': '#0052FF',
  }
});

// Event Listeners
connectBtn.addEventListener('click', () => {
  if (modal) modal.open();
});

startBtn.addEventListener('click', startSession);
stopBtn.addEventListener('click', stopAndClaim);
tapBtn.addEventListener('click', handleTap);

// Watch Account Changes
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
      
      setStatus('✅ Wallet connected! Click "Start Session" to begin.', 'success');
      updateStats();
      
    } else {
      userAddress = null;
      walletAddress.classList.add('hidden');
      connectBtn.classList.remove('hidden');
      actionButtons.classList.add('hidden');
      sessionTimer.classList.add('hidden');
      setStatus('Connect your wallet to start tapping!', 'info');
      
      // Reset session if disconnected
      if (sessionActive) {
        sessionActive = false;
        tapCount = 0;
        if (timerInterval) clearInterval(timerInterval);
      }
    }
  }
});

// Initialize App
(async () => {
  try {
    // Initialize Farcaster SDK
    isFarcasterEnvironment = await isFarcasterEmbed();
    
    if (isFarcasterEnvironment) {
      console.log('🎯 Running in Farcaster mini app');
      await initializeFarcasterSDK();
      
      // Try Farcaster auto-connect
      try {
        const farcasterConnector = wagmiConfig.connectors.find(c => c.id === 'farcasterMiniApp');
        if (farcasterConnector) {
          const conn = await connect(wagmiConfig, { connector: farcasterConnector });
          userAddress = conn.accounts[0];
          console.log('✅ Auto-connected via Farcaster:', userAddress);
        }
      } catch (e) {
        console.log('Farcaster auto-connect failed:', e);
      }
    } else {
      console.log('🌐 Running in browser');
    }
    
    // Load contract
    const loaded = await loadContract();
    if (!loaded) {
      setStatus('❌ Failed to load contract. Please refresh.', 'error');
      return;
    }
    
    // Check existing connection
    const currentAccount = getAccount(wagmiConfig);
    if (currentAccount.isConnected && currentAccount.address) {
      userAddress = currentAccount.address;
      const shortAddr = `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
      walletAddress.textContent = `Connected: ${shortAddr}`;
      walletAddress.classList.remove('hidden');
      walletAddress.onclick = () => modal.open();
      connectBtn.classList.add('hidden');
      actionButtons.classList.remove('hidden');
      setStatus('✅ Wallet connected! Click "Start Session" to begin.', 'success');
      await updateStats();
    }
    
    // Create particles
    createParticles();
    
  } catch (error) {
    console.error('Initialization error:', error);
    setStatus('Failed to initialize app. Please refresh.', 'error');
  }
})();