# Simple Token Vault

This is an Anchor program that implements a simple token vault with deposit and withdrawal functionality. The vault charges a configurable fee on withdrawals.

## Prerequisites

- Rust (version 1.59.0 or higher)
- Solana CLI (version 1.9.0 or higher)
- Anchor CLI (version 0.25.0 or higher)
- Node.js (version 14.0.0 or higher)
- Yarn (version 1.22.0 or higher)

## Building the Project

1. Clone the repository:

```bash
git clone https://github.com/your-repo/simple-token-vault.git
cd simple-token-vault
```

2. Install dependencies

```bash
yarn install
```

3. Build the Anchor program

```bash
anchor build
```

This will create the compiled program in the target/deploy/simple_token_vault.so file.

## Running Tests

1. Start a local Solana validator:

```bash
solana-test-validator
```

2. Run the test suite

```bash
anchor test
```

This will deploy the program to the local validator and run the test cases.

## Deploying the Program

1. Build the program

```bash
anchor build
```

2. Deploy the program to the Solana cluster

```bash
anchor deploy
```

This will deploy the program to the Solana cluster and update the simple_token_vault.json file with the program's address.

## Usage

The program provides the following instructions:

- initialize: Initializes the token vault with the specified fee.
- deposit: Deposits tokens into the vault.
- withdraw: Withdraws tokens from the vault, deducting the configured fee.
- change_fee: Updates the withdrawal fee.
