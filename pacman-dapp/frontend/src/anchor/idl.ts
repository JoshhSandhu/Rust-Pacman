export type PacmanGame = {
   "address": "3HpZLCtECuB6fQHtLQUSpV5SkT41z1ES3pkZv5tak91Z",
  "metadata": {
    "name": "pacmanGame",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "createGame",
      "discriminator": [
        124,
        69,
        75,
        66,
        184,
        220,
        72,
        206
      ],
      "accounts": [
        {
          "name": "game",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "playerMnt",
      "discriminator": [
        86,
        180,
        31,
        73,
        85,
        255,
        171,
        152
      ],
      "accounts": [
        {
          "name": "game",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "direction",
          "type": "u8"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "gameData",
      "discriminator": [
        237,
        88,
        58,
        243,
        16,
        69,
        238,
        190
      ]
    }
  ],
  "types": [
    {
      "name": "gameData",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "score",
            "type": "u64"
          },
          {
            "name": "playerX",
            "type": "u8"
          },
          {
            "name": "playerY",
            "type": "u8"
          },
          {
            "name": "board",
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    10
                  ]
                },
                10
              ]
            }
          }
        ]
      }
    }
  ]
};

export const IDL: PacmanGame = {
  "address": "3HpZLCtECuB6fQHtLQUSpV5SkT41z1ES3pkZv5tak91Z",
  "metadata": {
    "name": "pacmanGame",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "createGame",
      "discriminator": [
        124,
        69,
        75,
        66,
        184,
        220,
        72,
        206
      ],
      "accounts": [
        {
          "name": "game",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "playerMnt",
      "discriminator": [
        86,
        180,
        31,
        73,
        85,
        255,
        171,
        152
      ],
      "accounts": [
        {
          "name": "game",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "direction",
          "type": "u8"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "gameData",
      "discriminator": [
        237,
        88,
        58,
        243,
        16,
        69,
        238,
        190
      ]
    }
  ],
  "types": [
    {
      "name": "gameData",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "score",
            "type": "u64"
          },
          {
            "name": "playerX",
            "type": "u8"
          },
          {
            "name": "playerY",
            "type": "u8"
          },
          {
            "name": "board",
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    10
                  ]
                },
                10
              ]
            }
          }
        ]
      }
    }
  ]
};