export const RiskRegistry = [
  {
    type: "constructor",
    inputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "SAFE_THRESHOLD",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint8",
        internalType: "uint8"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "WARNING_THRESHOLD",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint8",
        internalType: "uint8"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "WATCH_THRESHOLD",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint8",
        internalType: "uint8"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "batchUpdateRiskScores",
    inputs: [
      {
        name: "protocols",
        type: "address[]",
        internalType: "address[]"
      },
      {
        name: "scores",
        type: "uint8[]",
        internalType: "uint8[]"
      },
      {
        name: "reasons",
        type: "string[]",
        internalType: "string[]"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "getProtocolRisk",
    inputs: [
      {
        name: "protocol",
        type: "address",
        internalType: "address"
      }
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct IRiskRegistry.ProtocolRisk",
        components: [
          {
            name: "riskScore",
            type: "uint8",
            internalType: "uint8"
          },
          {
            name: "threatLevel",
            type: "uint8",
            internalType: "enum IRiskRegistry.ThreatLevel"
          },
          {
            name: "lastUpdated",
            type: "uint256",
            internalType: "uint256"
          },
          {
            name: "isActive",
            type: "bool",
            internalType: "bool"
          }
        ]
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "getShieldHistory",
    inputs: [
      {
        name: "user",
        type: "address",
        internalType: "address"
      }
    ],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        internalType: "struct IRiskRegistry.ShieldAction[]",
        components: [
          {
            name: "protocol",
            type: "address",
            internalType: "address"
          },
          {
            name: "threatLevel",
            type: "uint8",
            internalType: "enum IRiskRegistry.ThreatLevel"
          },
          {
            name: "amountSaved",
            type: "uint256",
            internalType: "uint256"
          },
          {
            name: "reason",
            type: "string",
            internalType: "string"
          },
          {
            name: "timestamp",
            type: "uint256",
            internalType: "uint256"
          }
        ]
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "getThreatLevel",
    inputs: [
      {
        name: "protocol",
        type: "address",
        internalType: "address"
      }
    ],
    outputs: [
      {
        name: "",
        type: "uint8",
        internalType: "enum IRiskRegistry.ThreatLevel"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "getTotalAmountSaved",
    inputs: [
      {
        name: "user",
        type: "address",
        internalType: "address"
      }
    ],
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
    name: "isAuthorizedUpdater",
    inputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
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
    name: "isProtocolSafe",
    inputs: [
      {
        name: "protocol",
        type: "address",
        internalType: "address"
      }
    ],
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
    name: "logShieldAction",
    inputs: [
      {
        name: "user",
        type: "address",
        internalType: "address"
      },
      {
        name: "protocol",
        type: "address",
        internalType: "address"
      },
      {
        name: "threatLevel",
        type: "uint8",
        internalType: "enum IRiskRegistry.ThreatLevel"
      },
      {
        name: "amountSaved",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "reason",
        type: "string",
        internalType: "string"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
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
    name: "setAuthorizedUpdater",
    inputs: [
      {
        name: "updater",
        type: "address",
        internalType: "address"
      },
      {
        name: "authorized",
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
    name: "updateRiskScore",
    inputs: [
      {
        name: "protocol",
        type: "address",
        internalType: "address"
      },
      {
        name: "score",
        type: "uint8",
        internalType: "uint8"
      },
      {
        name: "reason",
        type: "string",
        internalType: "string"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
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
    name: "RiskScoreUpdated",
    inputs: [
      {
        name: "protocol",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "oldScore",
        type: "uint8",
        indexed: false,
        internalType: "uint8"
      },
      {
        name: "newScore",
        type: "uint8",
        indexed: false,
        internalType: "uint8"
      },
      {
        name: "threatLevel",
        type: "uint8",
        indexed: false,
        internalType: "enum IRiskRegistry.ThreatLevel"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "ShieldActionLogged",
    inputs: [
      {
        name: "user",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "protocol",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "threatLevel",
        type: "uint8",
        indexed: false,
        internalType: "enum IRiskRegistry.ThreatLevel"
      },
      {
        name: "amountSaved",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      },
      {
        name: "reason",
        type: "string",
        indexed: false,
        internalType: "string"
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
  }
] as const;
