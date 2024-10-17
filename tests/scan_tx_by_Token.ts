const web3 = require('@solana/web3.js');

const CONFIG = {
    BATCH_SIZE: 50,
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000,
    SCAN_INTERVAL: 10000,
    PRIMARY_RPC_ENDPOINT: 'https://solana-mainnet.g.alchemy.com/v2/r48Qm_kO9pu7O24rRaa_5xXaVeQGX_U7',
    FALLBACK_RPC_ENDPOINT: 'https://api.mainnet-beta.solana.com'
};

async function withRetry(fn, retries = CONFIG.MAX_RETRIES) {
    try {
        return await fn();
    } catch (error) {
        if (retries > 0) {
            console.log(`Error occurred. Retrying... (${retries} attempts left)`);
            await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
            return withRetry(fn, retries - 1);
        }
        throw error;
    }
}

async function getSwapEvents(connection, programId, tokens, fromSignature = null) {
    let swapEvents = [];

    try {
        const signaturesInfo = await withRetry(() =>
            connection.getSignaturesForAddress(programId, { limit: 100, before: fromSignature })
        );

        if (signaturesInfo.length === 0) return swapEvents;

        const signatureBatches = chunk(signaturesInfo.map(info => info.signature), CONFIG.BATCH_SIZE);

        for (const batch of signatureBatches) {
            const transactions = await Promise.all(
                batch.map(sig => getTransactionWithRetry(connection, sig))
            );

            for (const tx of transactions) {
                if (tx && tx.meta && tx.meta.logMessages) {
                    const isSwap = tx.meta.logMessages.some(log => log.includes('Swap'));

                    if (isSwap) {
                        const involvedTokens = tokens.filter(token =>
                            tx.meta.postTokenBalances.some(balance => balance.mint === token)
                        );

                        if (involvedTokens.length > 0) {
                            const event = {
                                signature: tx.transaction.signatures[0],
                                tokens: involvedTokens,
                                timestamp: tx.blockTime,
                                programId: programId.toBase58(),
                            };

                            swapEvents.push(event);
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error(`Error fetching swap events for program ${programId.toBase58()}:`, error);
    }

    return swapEvents;
}

async function getTransactionWithRetry(connection, signature, retries = CONFIG.MAX_RETRIES) {
    return withRetry(() =>
        connection.getTransaction(signature, { maxSupportedTransactionVersion: 0 })
    );
}

function chunk(array, size) {
    return Array.from({ length: Math.ceil(array.length / size) }, (v, i) =>
        array.slice(i * size, i * size + size)
    );
}

async function scanSwaps(primaryConnection, fallbackConnection, raydiumProgramId, serumProgramId, tokens) {
    let lastRaydiumSignature = null;
    let lastSerumSignature = null;
    let currentConnection = primaryConnection;

    while (true) {
        console.log('Scanning for new swap events...');

        try {
            const raydiumSwaps = await getSwapEvents(currentConnection, raydiumProgramId, tokens, lastRaydiumSignature);
            const serumSwaps = await getSwapEvents(currentConnection, serumProgramId, tokens, lastSerumSignature);

            if (raydiumSwaps.length > 0) {
                lastRaydiumSignature = raydiumSwaps[0].signature;
                console.log(`Found ${raydiumSwaps.length} new Raydium swap events`);
                console.log(JSON.stringify(raydiumSwaps, null, 2));
            }

            if (serumSwaps.length > 0) {
                lastSerumSignature = serumSwaps[0].signature;
                console.log(`Found ${serumSwaps.length} new Serum swap events`);
                console.log(JSON.stringify(serumSwaps, null, 2));
            }

            if (raydiumSwaps.length === 0 && serumSwaps.length === 0) {
                console.log('No new swap events found');
            }

        } catch (error) {
            console.error('Error during swap scanning:', error);
            if (currentConnection === primaryConnection) {
                console.log('Switching to fallback RPC...');
                currentConnection = fallbackConnection;
            } else {
                console.log('Switching back to primary RPC...');
                currentConnection = primaryConnection;
            }
        }

        // Wait for the next scan interval
        await new Promise(resolve => setTimeout(resolve, CONFIG.SCAN_INTERVAL));
    }
}

async function main() {
    const primaryConnection = new web3.Connection(CONFIG.PRIMARY_RPC_ENDPOINT, 'confirmed');
    const fallbackConnection = new web3.Connection(CONFIG.FALLBACK_RPC_ENDPOINT, 'confirmed');

    const raydiumSwapProgramId = new web3.PublicKey('SwaPpA9LAaLfeLi3a68M4DjnLqgtticKg6CnyNwgAC8');
    const serumDexProgramId = new web3.PublicKey('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin');

    const tokens = [
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        // 'So11111111111111111111111111111111111111112',  // Wrapped SOL
    ];

    console.log('Starting periodic swap scanning...');
    await scanSwaps(primaryConnection, fallbackConnection, raydiumSwapProgramId, serumDexProgramId, tokens);
}

main().catch(console.error);