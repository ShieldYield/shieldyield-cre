export const YieldMaxAdapter = [
    {
        type: "constructor",
        inputs: [
            {
                name: "_asset",
                type: "address",
                internalType: "address"
            },
            {
                name: "protocolName_",
                type: "string",
                internalType: "string"
            },
            {
                name: "apy_",
                type: "uint256",
                internalType: "uint256"
            }
        ],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "asset",
        inputs: [],
        outputs: [
            {
                name: "",
                type: "address",
                internalType: "address"
            }
        ],
        stateMutability: "view"
    },
    {
        type: "function",
        name: "deposit",
        inputs: [
            {
                name: "amount",
                type: "uint256",
                internalType: "uint256"
            }
        ],
        outputs: [
            {
                name: "shares",
                type: "uint256",
                internalType: "uint256"
            }
        ],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "emergencyWithdraw",
        inputs: [],
        outputs: [
            {
                name: "withdrawn",
                type: "uint256",
                internalType: "uint256"
            }
        ],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "getBalance",
        inputs: [],
        outputs: [
            {
                name: "",
                type: "uint256",
                internalType: "uint256"
            }
        ],
        stateMutability: "view"
    },
    {
        type: "function",
        name: "getBalanceBreakdown",
        inputs: [],
        outputs: [
            {
                name: "principal",
                type: "uint256",
                internalType: "uint256"
            },
            {
                name: "accruedYield",
                type: "uint256",
                internalType: "uint256"
            },
            {
                name: "currentBalance",
                type: "uint256",
                internalType: "uint256"
            }
        ],
        stateMutability: "view"
    },
    {
        type: "function",
        name: "getCurrentAPY",
        inputs: [],
        outputs: [
            {
                name: "",
                type: "uint256",
                internalType: "uint256"
            }
        ],
        stateMutability: "view"
    },
    {
        type: "function",
        name: "getYieldPerSecond",
        inputs: [],
        outputs: [
            {
                name: "yieldPerSecond",
                type: "uint256",
                internalType: "uint256"
            }
        ],
        stateMutability: "view"
    },
    {
        type: "function",
        name: "isHealthy",
        inputs: [],
        outputs: [
            {
                name: "",
                type: "bool",
                internalType: "bool"
            }
        ],
        stateMutability: "view"
    },
    {
        type: "function",
        name: "owner",
        inputs: [],
        outputs: [
            {
                name: "",
                type: "address",
                internalType: "address"
            }
        ],
        stateMutability: "view"
    },
    {
        type: "function",
        name: "pause",
        inputs: [],
        outputs: [],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "paused",
        inputs: [],
        outputs: [
            {
                name: "",
                type: "bool",
                internalType: "bool"
            }
        ],
        stateMutability: "view"
    },
    {
        type: "function",
        name: "protocolName",
        inputs: [],
        outputs: [
            {
                name: "",
                type: "string",
                internalType: "string"
            }
        ],
        stateMutability: "view"
    },
    {
        type: "function",
        name: "renounceOwnership",
        inputs: [],
        outputs: [],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "rescueTokens",
        inputs: [
            {
                name: "token",
                type: "address",
                internalType: "address"
            },
            {
                name: "to",
                type: "address",
                internalType: "address"
            }
        ],
        outputs: [],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "setAPY",
        inputs: [
            {
                name: "apy_",
                type: "uint256",
                internalType: "uint256"
            }
        ],
        outputs: [],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "setHealthy",
        inputs: [
            {
                name: "healthy_",
                type: "bool",
                internalType: "bool"
            }
        ],
        outputs: [],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "setShieldVault",
        inputs: [
            {
                name: "_shieldVault",
                type: "address",
                internalType: "address"
            }
        ],
        outputs: [],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "shieldVault",
        inputs: [],
        outputs: [
            {
                name: "",
                type: "address",
                internalType: "address"
            }
        ],
        stateMutability: "view"
    },
    {
        type: "function",
        name: "simulateLoss",
        inputs: [
            {
                name: "lossAmount",
                type: "uint256",
                internalType: "uint256"
            }
        ],
        outputs: [],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "simulateTimePassing",
        inputs: [
            {
                name: "secondsToAdd",
                type: "uint256",
                internalType: "uint256"
            }
        ],
        outputs: [],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "simulateYield",
        inputs: [
            {
                name: "yieldAmount",
                type: "uint256",
                internalType: "uint256"
            }
        ],
        outputs: [],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "transferOwnership",
        inputs: [
            {
                name: "newOwner",
                type: "address",
                internalType: "address"
            }
        ],
        outputs: [],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "unpause",
        inputs: [],
        outputs: [],
        stateMutability: "nonpayable"
    },
    {
        type: "function",
        name: "withdraw",
        inputs: [
            {
                name: "amount",
                type: "uint256",
                internalType: "uint256"
            }
        ],
        outputs: [
            {
                name: "withdrawn",
                type: "uint256",
                internalType: "uint256"
            }
        ],
        stateMutability: "nonpayable"
    },
    {
        type: "event",
        name: "Deposited",
        inputs: [
            {
                name: "amount",
                type: "uint256",
                indexed: false,
                internalType: "uint256"
            },
            {
                name: "shares",
                type: "uint256",
                indexed: false,
                internalType: "uint256"
            }
        ],
        anonymous: false
    },
    {
        type: "event",
        name: "EmergencyWithdrawn",
        inputs: [
            {
                name: "amount",
                type: "uint256",
                indexed: false,
                internalType: "uint256"
            }
        ],
        anonymous: false
    },
    {
        type: "event",
        name: "MockDeposit",
        inputs: [
            {
                name: "amount",
                type: "uint256",
                indexed: false,
                internalType: "uint256"
            }
        ],
        anonymous: false
    },
    {
        type: "event",
        name: "MockWithdraw",
        inputs: [
            {
                name: "amount",
                type: "uint256",
                indexed: false,
                internalType: "uint256"
            }
        ],
        anonymous: false
    },
    {
        type: "event",
        name: "OwnershipTransferred",
        inputs: [
            {
                name: "previousOwner",
                type: "address",
                indexed: true,
                internalType: "address"
            },
            {
                name: "newOwner",
                type: "address",
                indexed: true,
                internalType: "address"
            }
        ],
        anonymous: false
    },
    {
        type: "event",
        name: "Paused",
        inputs: [
            {
                name: "by",
                type: "address",
                indexed: true,
                internalType: "address"
            }
        ],
        anonymous: false
    },
    {
        type: "event",
        name: "ShieldVaultSet",
        inputs: [
            {
                name: "shieldVault",
                type: "address",
                indexed: true,
                internalType: "address"
            }
        ],
        anonymous: false
    },
    {
        type: "event",
        name: "Unpaused",
        inputs: [
            {
                name: "by",
                type: "address",
                indexed: true,
                internalType: "address"
            }
        ],
        anonymous: false
    },
    {
        type: "event",
        name: "Withdrawn",
        inputs: [
            {
                name: "amount",
                type: "uint256",
                indexed: false,
                internalType: "uint256"
            },
            {
                name: "received",
                type: "uint256",
                indexed: false,
                internalType: "uint256"
            }
        ],
        anonymous: false
    },
    {
        type: "event",
        name: "YieldAccrued",
        inputs: [
            {
                name: "yieldAmount",
                type: "uint256",
                indexed: false,
                internalType: "uint256"
            },
            {
                name: "newBalance",
                type: "uint256",
                indexed: false,
                internalType: "uint256"
            }
        ],
        anonymous: false
    },
    {
        type: "error",
        name: "OwnableInvalidOwner",
        inputs: [
            {
                name: "owner",
                type: "address",
                internalType: "address"
            }
        ]
    },
    {
        type: "error",
        name: "OwnableUnauthorizedAccount",
        inputs: [
            {
                name: "account",
                type: "address",
                internalType: "address"
            }
        ]
    },
    {
        type: "error",
        name: "SafeERC20FailedOperation",
        inputs: [
            {
                name: "token",
                type: "address",
                internalType: "address"
            }
        ]
    }
] as const;
