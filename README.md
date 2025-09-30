# Voting-Dapp (Solidity + Vite + ethers v6)
On-chain voting DApp: owner-managed candidates, one-address-one-vote, real-time results with live events and a polished Vite + ethers v6 frontend (MetaMask connect, Sepolia guard, admin panel)

Owner-managed on-chain voting with a clean, real-time frontend. Add candidates, toggle voting, and let each address vote once. The UI handles MetaMask connect reliably, switches to Sepolia if needed, and updates live from contract events.

 FEATURES
- Admin panel: addCandidate, toggleVoting (on/off), resetVoting
- One-address-one-vote (enforced in the contract)
- Live results with animated progress bars
- Activity feed (voted, candidateAdded, reset) via event subscriptions

  
 STACK
* Frontend: Vite, JavaScript, HTML/CSS, ethers.js v6, MetaMask
* Smart contract: Solidity (owner-gated voting + events)
* Network: Sepolia testnet

  Prerequisites:
- Node.js 18+ and npm
- MetaMask in your browser (with Sepolia enabled)
- A tiny bit of Sepolia ETH for gas if you want to send transactions

Install and run:
```bash
npm install
npm run dev


  
