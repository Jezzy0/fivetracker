const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function verifyDependencies() {
    const requiredModules = ['express', 'cors', 'axios'];
    let missingModules = false;

    for (const mod of requiredModules) {
        try {
            require.resolve(mod);
        } catch (e) {
            missingModules = true;
            break;
        }
    }

    if (missingModules) {
        console.log("⚠️ Missing dependencies. Auto-running background installer...");
        try {
            execSync('npm install', { stdio: 'inherit', cwd: __dirname });
        } catch (error) {
            console.error("❌ Automatic installation crashed.");
            process.exit(1);
        }
    }
}
verifyDependencies();

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const serverSessionCache = {};

app.get('/api/track/:input', async (req, res) => {
    let userInput = req.params.input.trim();

    if (userInput.includes('cfx.re/join/')) {
        userInput = userInput.split('cfx.re/join/')[1];
    } else if (userInput.includes('/')) {
        const parts = userInput.split('/');
        userInput = parts[parts.length - 1];
    }

    if (!userInput || userInput.length !== 6) {
        return res.status(400).json({ error: 'Please enter a valid 6-character join code.' });
    }

    try {
        const inviteUrl = `https://cfx.re/join/${userInput}`;
        const inviteResponse = await axios.get(inviteUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            maxRedirects: 0, 
            validateStatus: (status) => status >= 200 && status < 400 
        });

        const gameEndpoint = inviteResponse.headers['x-citizenfx-url'];
        if (!gameEndpoint) {
            return res.status(404).json({ error: 'Server offline or invalid code.' });
        }

        const cleanIp = gameEndpoint.replace(/\/$/, '');
        const rawIpOrHost = cleanIp.replace(/^https?:\/\//, '').split(':')[0];

        const [dynamicRes, playersRes, geoRes] = await Promise.all([
            axios.get(`${cleanIp}/dynamic.json`, { timeout: 4000 }),
            axios.get(`${cleanIp}/players.json`, { timeout: 4000 }),
            axios.get(`http://ip-api.com/json/${rawIpOrHost}?fields=status,country,city,isp,as,org`).catch(() => null)
        ]);

        const d = dynamicRes.data;
        const vars = d.vars || {};
        const currentTime = Date.now();

        if (!serverSessionCache[userInput]) {
            serverSessionCache[userInput] = {};
        }

        const activePlayers = Array.isArray(playersRes.data) ? playersRes.data : [];
        const currentServerCache = serverSessionCache[userInput];
        const updatedCache = {};

        // Calculate average player latency across the board
        let totalPing = 0;
        const mappedPlayers = activePlayers.map(p => {
            const playerUniqueKey = `${p.id}-${p.name}`;
            updatedCache[playerUniqueKey] = currentServerCache[playerUniqueKey] || currentTime;
            totalPing += (p.ping || 0);

            const joinTime = updatedCache[playerUniqueKey];
            const totalSeconds = Math.floor((currentTime - joinTime) / 1000);
            
            let playTimeStr = "Just Joined";
            if (totalSeconds >= 60) {
                const mins = Math.floor(totalSeconds / 60) % 60;
                const hrs = Math.floor(totalSeconds / 3600);
                playTimeStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
            }

            const ids = Array.isArray(p.identifiers) ? p.identifiers : [];
            const steamHex = ids.find(i => i.startsWith('steam:'))?.replace('steam:', '') || null;
            let steam64 = null;
            if (steamHex) {
                try { steam64 = BigInt("0x" + steamHex).toString(); } catch(e){}
            }

            return {
                id: p.id || 0,
                name: p.name || 'Anonymous Player',
                ping: p.ping || 0,
                playTime: playTimeStr,
                discord: ids.find(i => i.startsWith('discord:'))?.replace('discord:', '') || null,
                steam: steam64
            };
        });

        serverSessionCache[userInput] = updatedCache;
        const avgNetworkPing = activePlayers.length > 0 ? Math.round(totalPing / activePlayers.length) : 0;

        // --- DEEP RECONSTRUCTION HEURISTIC ENGINE ---
        let discoveredResources = Array.isArray(d.resources) ? [...d.resources] : [];
        let explicitlyHidden = discoveredResources.length === 0;

        // Extract scripts leaked or declared inside raw variables tags and host metadata text
        const targetStringDump = `${vars.tags || ''} ${d.hostname || ''} ${vars.sv_projectDesc || ''}`.toLowerCase();
        
        const knownAssets = [
            { key: 'ox_inventory', name: '📦 Ox Inventory System' },
            { key: 'qb-inventory', name: '📦 QB Inventory Ecosystem' },
            { key: 'qs-inventory', name: '📦 Quasar Advanced Inventory' },
            { key: 'ox_lib', name: '⚙️ Ox Library Utils' },
            { key: 'vmenu', name: '🔧 vMenu Client Overlay' },
            { key: 'esx_policejob', name: '🚓 ESX Law Enforcement Framework' },
            { key: 'qb-policejob', name: '🚓 QB Police & Dispatch System' },
            { key: 'pma-voice', name: '🔊 PMA Real-Time Voice Grid' },
            { key: 'saltychat', name: '🔊 SaltyChat TeamSpeak System' },
            { key: 'ox_target', name: '🎯 Ox Target Interactor' },
            { key: 'qb-target', name: '🎯 QB Raycast Target Helper' },
            { key: 'bob74_ipl', name: '🗺️ Bob74 Map Interior Loader' },
            { key: 'gabz', name: '🗺️ Gabz Custom MLO Interiors' }
        ];

        knownAssets.forEach(asset => {
            if (targetStringDump.includes(asset.key) && !discoveredResources.includes(asset.name)) {
                discoveredResources.push(`${asset.name} (Inferred from Tags)`);
            }
        });

        // Determine framework type profile
        let framework = 'Standalone / Custom';
        if (targetStringDump.includes('qbcore') || targetStringDump.includes('qb-core')) framework = 'QB-Core Ecosystem';
        else if (targetStringDump.includes('esx') || targetStringDump.includes('essentialmode')) framework = 'ESX Legacy Framework';
        else if (targetStringDump.includes('vrp')) framework = 'vRP Engine Architecture';
        else if (targetStringDump.includes('qbx') || targetStringDump.includes('qbox')) framework = 'Qbox Next-Gen Framework';

        // Version Security Assessment (Checking outdated FXServer Artifact versions)
        let securityStatus = 'Excellent (Protected)';
        let serverVersionString = d.server || 'Unknown Build';
        let serverArtifactNum = parseInt(serverVersionString.match(/v1\.0\.0\.(\hd+)/)?.[1] || '0', 10);
        if (serverArtifactNum > 0 && serverArtifactNum < 8000) {
            securityStatus = `Vulnerable Build (Artifact #${serverArtifactNum} Outdated)`;
        }

        const payload = {
            code: userInput,
            ip: cleanIp.replace(/^https?:\/\//, ''),
            name: d.hostname || 'FiveM Server Node',
            clients: d.clients !== undefined ? d.clients : 0,
            maxClients: d.sv_maxclients || 0,
            gameBuild: vars.sv_enforceGameBuild || 'Standard Production',
            oneSync: vars.onesync_enabled || 'false',
            txAdmin: vars.txAdmin_version ? `Active (v${vars.txAdmin_version})` : 'Not Detected',
            location: geoRes?.data?.status === 'success' ? `${geoRes.data.city}, ${geoRes.data.country}` : 'Unknown Location',
            isp: geoRes?.data?.status === 'success' ? `${geoRes.data.isp} (${geoRes.data.org || 'Data Center'})` : 'Unknown Infrastructure Host',
            
            // New Advanced Telemetry Fields
            framework: framework,
            avgPing: avgNetworkPing,
            securityStatus: securityStatus,
            serverVersion: serverVersionString.split(' ')[0],
            isObfuscated: explicitlyHidden,
            scriptCount: explicitlyHidden ? `${discoveredResources.length} Extracted` : discoveredResources.length,
            resourcesList: discoveredResources.sort(),
            projectDesc: vars.sv_projectDesc || 'No overview text provided.',
            serverIcon: d.icon ? `data:image/png;base64,${d.icon}` : null,
            players: mappedPlayers
        };

        return res.json(payload);
    } catch (error) {
        return res.status(502).json({ error: 'Failed to complete target network audit.' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Telemetry Diagnostics operating on Port ${PORT}`);
});