export const ShieldBridge = [
  {
    type: "constructor",
    inputs: [
      {
        name: "_router",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "nonpayable"
  },
  {
    type: "receive",
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "ARBITRUM_SELECTOR",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint64",
        internalType: "uint64"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "ARB_SEPOLIA_SELECTOR",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint64",
        internalType: "uint64"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "AVALANCHE_SELECTOR",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint64",
        internalType: "uint64"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "BASE_SELECTOR",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint64",
        internalType: "uint64"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "BASE_SEPOLIA_SELECTOR",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint64",
        internalType: "uint64"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "ETHEREUM_SELECTOR",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint64",
        internalType: "uint64"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "OPTIMISM_SELECTOR",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint64",
        internalType: "uint64"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "OP_SEPOLIA_SELECTOR",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint64",
        internalType: "uint64"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "POLYGON_SELECTOR",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint64",
        internalType: "uint64"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "SEPOLIA_SELECTOR",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint64",
        internalType: "uint64"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "ccipReceive",
    inputs: [
      {
        name: "message",
        type: "tuple",
        internalType: "struct IAny2EVMMessageReceiver.Any2EVMMessage",
        components: [
          {
            name: "messageId",
            type: "bytes32",
            internalType: "bytes32"
          },
          {
            name: "sourceChainSelector",
            type: "uint64",
            internalType: "uint64"
          },
          {
            name: "sender",
            type: "bytes",
            internalType: "bytes"
          },
          {
            name: "data",
            type: "bytes",
            internalType: "bytes"
          },
          {
            name: "destTokenAmounts",
            type: "tuple[]",
            internalType: "struct IAny2EVMMessageReceiver.EVMTokenAmount[]",
            components: [
              {
                name: "token",
                type: "address",
                internalType: "address"
              },
              {
                name: "amount",
                type: "uint256",
                internalType: "uint256"
              }
            ]
          }
        ]
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "chainToReceiver",
    inputs: [
      {
        name: "",
        type: "uint64",
        internalType: "uint64"
      }
    ],
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
    name: "chainToSafeHaven",
    inputs: [
      {
        name: "",
        type: "uint64",
        internalType: "uint64"
      }
    ],
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
    name: "creAddress",
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
    name: "emergencyBridge",
    inputs: [
      {
        name: "token",
        type: "address",
        internalType: "address"
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "destinationChainSelector",
        type: "uint64",
        internalType: "uint64"
      }
    ],
    outputs: [
      {
        name: "messageId",
        type: "bytes32",
        internalType: "bytes32"
      }
    ],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "emergencyBridgeCount",
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
    name: "getEmergencyBridgeFee",
    inputs: [
      {
        name: "token",
        type: "address",
        internalType: "address"
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "destinationChainSelector",
        type: "uint64",
        internalType: "uint64"
      }
    ],
    outputs: [
      {
        name: "fee",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "getSupportedChains",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint64[]",
        internalType: "uint64[]"
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
    name: "renounceOwnership",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "rescueETH",
    inputs: [
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
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "router",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IRouterClient"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "setCREAddress",
    inputs: [
      {
        name: "_creAddress",
        type: "address",
        internalType: "address"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "setChainReceiver",
    inputs: [
      {
        name: "chainSelector",
        type: "uint64",
        internalType: "uint64"
      },
      {
        name: "receiver",
        type: "address",
        internalType: "address"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "setChainSafeHaven",
    inputs: [
      {
        name: "chainSelector",
        type: "uint64",
        internalType: "uint64"
      },
      {
        name: "safeHaven",
        type: "address",
        internalType: "address"
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
    name: "supportedChains",
    inputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [
      {
        name: "",
        type: "uint64",
        internalType: "uint64"
      }
    ],
    stateMutability: "view"
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
    type: "event",
    name: "CREAddressUpdated",
    inputs: [
      {
        name: "oldCRE",
        type: "address",
        indexed: false,
        internalType: "address"
      },
      {
        name: "newCRE",
        type: "address",
        indexed: false,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "EmergencyBridgeInitiated",
    inputs: [
      {
        name: "messageId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32"
      },
      {
        name: "destinationChain",
        type: "uint64",
        indexed: true,
        internalType: "uint64"
      },
      {
        name: "token",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      },
      {
        name: "sender",
        type: "address",
        indexed: false,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "EmergencyBridgeReceived",
    inputs: [
      {
        name: "messageId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32"
      },
      {
        name: "sourceChain",
        type: "uint64",
        indexed: true,
        internalType: "uint64"
      },
      {
        name: "token",
        type: "address",
        indexed: true,
        internalType: "address"
      },
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
    name: "ReceiverUpdated",
    inputs: [
      {
        name: "chainSelector",
        type: "uint64",
        indexed: true,
        internalType: "uint64"
      },
      {
        name: "receiver",
        type: "address",
        indexed: false,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "SafeHavenUpdated",
    inputs: [
      {
        name: "chainSelector",
        type: "uint64",
        indexed: true,
        internalType: "uint64"
      },
      {
        name: "safeHaven",
        type: "address",
        indexed: false,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "ShieldVaultUpdated",
    inputs: [
      {
        name: "oldVault",
        type: "address",
        indexed: false,
        internalType: "address"
      },
      {
        name: "newVault",
        type: "address",
        indexed: false,
        internalType: "address"
      }
    ],
    anonymous: false
  },
  {
    type: "error",
    name: "BridgeFailed",
    inputs: []
  },
  {
    type: "error",
    name: "InsufficientFee",
    inputs: [
      {
        name: "required",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "provided",
        type: "uint256",
        internalType: "uint256"
      }
    ]
  },
  {
    type: "error",
    name: "InvalidChain",
    inputs: []
  },
  {
    type: "error",
    name: "InvalidReceiver",
    inputs: []
  },
  {
    type: "error",
    name: "InvalidRouter",
    inputs: []
  },
  {
    type: "error",
    name: "OnlyRouter",
    inputs: []
  },
  {
    type: "error",
    name: "OnlyShieldVaultOrCRE",
    inputs: []
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
    name: "ReentrancyGuardReentrantCall",
    inputs: []
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
  },
  {
    type: "error",
    name: "UnsupportedChain",
    inputs: [
      {
        name: "chainSelector",
        type: "uint64",
        internalType: "uint64"
      }
    ]
  },
  {
    type: "error",
    name: "UnsupportedToken",
    inputs: [
      {
        name: "token",
        type: "address",
        internalType: "address"
      }
    ]
  }
] as const;
