import type { Project } from "./types";

// Exact user-authored named save: 苜蓿叶立交 · 2主线＋2辅道 改进版.
const saved: Project = {
  "version": 1,
  "name": "苜蓿叶立交 · 2主线＋2辅道",
  "roads": [
    {
      "id": "cloverleaf-east-in",
      "name": "东行 · 入口（4车道）",
      "knots": [
        {
          "p": {
            "x": -540,
            "y": 0,
            "z": 16
          },
          "incoming": {
            "x": -540,
            "y": 0,
            "z": 16
          },
          "outgoing": {
            "x": -506.66666666666674,
            "y": 0,
            "z": 16
          },
          "at": 0
        },
        {
          "p": {
            "x": -440,
            "y": 0,
            "z": 16
          },
          "incoming": {
            "x": -473.33333333333337,
            "y": 0,
            "z": 16
          },
          "outgoing": {
            "x": -440,
            "y": 0,
            "z": 16
          },
          "at": 1
        }
      ],
      "lanesStart": 4,
      "lanesEnd": 4,
      "twoWay": false,
      "width": 4,
      "speed": 100,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true
    },
    {
      "id": "cloverleaf-east-out",
      "name": "东行 · 出口（4车道）",
      "knots": [
        {
          "p": {
            "x": 440,
            "y": 0,
            "z": 16
          },
          "incoming": {
            "x": 440,
            "y": 0,
            "z": 16
          },
          "outgoing": {
            "x": 473.33333333333337,
            "y": 0,
            "z": 16
          },
          "at": 0
        },
        {
          "p": {
            "x": 540,
            "y": 0,
            "z": 16
          },
          "incoming": {
            "x": 506.6666666666667,
            "y": 0,
            "z": 16
          },
          "outgoing": {
            "x": 540,
            "y": 0,
            "z": 16
          },
          "at": 1
        }
      ],
      "lanesStart": 4,
      "lanesEnd": 4,
      "twoWay": false,
      "width": 4,
      "speed": 100,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true
    },
    {
      "id": "cloverleaf-east-collector-0",
      "name": "东行 · 辅道 1（2车道）",
      "knots": [
        {
          "p": {
            "x": -440,
            "y": 0,
            "z": 20
          },
          "incoming": {
            "x": -440,
            "y": 0,
            "z": 20
          },
          "outgoing": {
            "x": -420,
            "y": 0,
            "z": 20
          },
          "at": 0
        },
        {
          "p": {
            "x": -380,
            "y": 0,
            "z": 24
          },
          "incoming": {
            "x": -400,
            "y": 0,
            "z": 24
          },
          "outgoing": {
            "x": -380,
            "y": 0,
            "z": 24
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 70,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true,
      "attachments": {
        "start": {
          "road": "cloverleaf-east-in",
          "end": 1,
          "lanes": [
            2,
            3
          ],
          "ownLanes": [
            0,
            1
          ]
        }
      }
    },
    {
      "id": "cloverleaf-east-collector-1",
      "name": "单车道匝道",
      "knots": [
        {
          "p": {
            "x": -380,
            "y": 0,
            "z": 24
          },
          "incoming": {
            "x": -380,
            "y": 0,
            "z": 24
          },
          "outgoing": {
            "x": -280.6666666666667,
            "y": 0,
            "z": 24
          },
          "at": 0
        },
        {
          "p": {
            "x": -82,
            "y": 0,
            "z": 24
          },
          "incoming": {
            "x": -181.33333333333331,
            "y": 0,
            "z": 24
          },
          "outgoing": {
            "x": -82,
            "y": 0,
            "z": 24
          },
          "at": 1
        }
      ],
      "lanesStart": 1,
      "lanesEnd": 1,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "ramp",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true,
      "attachments": {},
      "sectionOffset": -2,
      "replacedSection": {
        "name": "东行 · 辅道 2（2车道）",
        "lanesStart": 2,
        "lanesEnd": 2,
        "transitionMode": "direct",
        "twoWay": false,
        "width": 4,
        "speed": 70,
        "align": "center",
        "kind": "road",
        "highwayRules": true,
        "transitionStart": 0,
        "transitionEnd": 1
      }
    },
    {
      "id": "cloverleaf-east-collector-2",
      "name": "东行 · 辅道 3（2车道）",
      "knots": [
        {
          "p": {
            "x": -82,
            "y": 0,
            "z": 24
          },
          "incoming": {
            "x": -82,
            "y": 0,
            "z": 24
          },
          "outgoing": {
            "x": -27.333333333333336,
            "y": 0,
            "z": 24
          },
          "at": 0
        },
        {
          "p": {
            "x": 82,
            "y": 0,
            "z": 24
          },
          "incoming": {
            "x": 27.333333333333336,
            "y": 0,
            "z": 24
          },
          "outgoing": {
            "x": 82,
            "y": 0,
            "z": 24
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 70,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true,
      "attachments": {}
    },
    {
      "id": "cloverleaf-east-collector-3",
      "name": "单车道匝道",
      "knots": [
        {
          "p": {
            "x": 82,
            "y": 0,
            "z": 24
          },
          "incoming": {
            "x": 82,
            "y": 0,
            "z": 24
          },
          "outgoing": {
            "x": 181.33333333333331,
            "y": 0,
            "z": 24
          },
          "at": 0
        },
        {
          "p": {
            "x": 380,
            "y": 0,
            "z": 24
          },
          "incoming": {
            "x": 280.6666666666667,
            "y": 0,
            "z": 24
          },
          "outgoing": {
            "x": 380,
            "y": 0,
            "z": 24
          },
          "at": 1
        }
      ],
      "lanesStart": 1,
      "lanesEnd": 1,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "ramp",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true,
      "attachments": {},
      "sectionOffset": -2,
      "replacedSection": {
        "name": "东行 · 辅道 4（2车道）",
        "lanesStart": 2,
        "lanesEnd": 2,
        "transitionMode": "direct",
        "twoWay": false,
        "width": 4,
        "speed": 70,
        "align": "center",
        "kind": "road",
        "highwayRules": true,
        "transitionStart": 0,
        "transitionEnd": 1
      }
    },
    {
      "id": "cloverleaf-east-collector-4",
      "name": "东行 · 辅道 5（2车道）",
      "knots": [
        {
          "p": {
            "x": 380,
            "y": 0,
            "z": 24
          },
          "incoming": {
            "x": 380,
            "y": 0,
            "z": 24
          },
          "outgoing": {
            "x": 400,
            "y": 0,
            "z": 24
          },
          "at": 0
        },
        {
          "p": {
            "x": 440,
            "y": 0,
            "z": 20
          },
          "incoming": {
            "x": 420,
            "y": 0,
            "z": 20
          },
          "outgoing": {
            "x": 440,
            "y": 0,
            "z": 20
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 70,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true,
      "attachments": {
        "end": {
          "road": "cloverleaf-east-out",
          "end": 0,
          "lanes": [
            2,
            3
          ],
          "ownLanes": [
            0,
            1
          ]
        }
      }
    },
    {
      "id": "cloverleaf-south-in",
      "name": "南行 · 入口（4车道）",
      "knots": [
        {
          "p": {
            "x": -16,
            "y": 8,
            "z": -540
          },
          "incoming": {
            "x": -16,
            "y": 8,
            "z": -540
          },
          "outgoing": {
            "x": -16,
            "y": 8,
            "z": -506.66666666666674
          },
          "at": 0
        },
        {
          "p": {
            "x": -16,
            "y": 8,
            "z": -440
          },
          "incoming": {
            "x": -16,
            "y": 8,
            "z": -473.33333333333337
          },
          "outgoing": {
            "x": -16,
            "y": 8,
            "z": -440
          },
          "at": 1
        }
      ],
      "lanesStart": 4,
      "lanesEnd": 4,
      "twoWay": false,
      "width": 4,
      "speed": 100,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true
    },
    {
      "id": "cloverleaf-south-out",
      "name": "南行 · 出口（4车道）",
      "knots": [
        {
          "p": {
            "x": -16,
            "y": 8,
            "z": 440
          },
          "incoming": {
            "x": -16,
            "y": 8,
            "z": 440
          },
          "outgoing": {
            "x": -16,
            "y": 8,
            "z": 473.33333333333337
          },
          "at": 0
        },
        {
          "p": {
            "x": -16,
            "y": 8,
            "z": 540
          },
          "incoming": {
            "x": -16,
            "y": 8,
            "z": 506.6666666666667
          },
          "outgoing": {
            "x": -16,
            "y": 8,
            "z": 540
          },
          "at": 1
        }
      ],
      "lanesStart": 4,
      "lanesEnd": 4,
      "twoWay": false,
      "width": 4,
      "speed": 100,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true
    },
    {
      "id": "cloverleaf-south-collector-0",
      "name": "南行 · 辅道 1（2车道）",
      "knots": [
        {
          "p": {
            "x": -20,
            "y": 8,
            "z": -440
          },
          "incoming": {
            "x": -20,
            "y": 8,
            "z": -440
          },
          "outgoing": {
            "x": -20,
            "y": 8,
            "z": -420
          },
          "at": 0
        },
        {
          "p": {
            "x": -24,
            "y": 8,
            "z": -380
          },
          "incoming": {
            "x": -24,
            "y": 8,
            "z": -400
          },
          "outgoing": {
            "x": -24,
            "y": 8,
            "z": -380
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 70,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true,
      "attachments": {
        "start": {
          "road": "cloverleaf-south-in",
          "end": 1,
          "lanes": [
            2,
            3
          ],
          "ownLanes": [
            0,
            1
          ]
        }
      }
    },
    {
      "id": "cloverleaf-south-collector-1",
      "name": "单车道匝道",
      "knots": [
        {
          "p": {
            "x": -24,
            "y": 8,
            "z": -380
          },
          "incoming": {
            "x": -24,
            "y": 8,
            "z": -380
          },
          "outgoing": {
            "x": -24,
            "y": 8,
            "z": -280.6666666666667
          },
          "at": 0
        },
        {
          "p": {
            "x": -24,
            "y": 8,
            "z": -82
          },
          "incoming": {
            "x": -24,
            "y": 8,
            "z": -181.33333333333331
          },
          "outgoing": {
            "x": -24,
            "y": 8,
            "z": -82
          },
          "at": 1
        }
      ],
      "lanesStart": 1,
      "lanesEnd": 1,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "ramp",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true,
      "attachments": {},
      "sectionOffset": -2,
      "replacedSection": {
        "name": "南行 · 辅道 2（2车道）",
        "lanesStart": 2,
        "lanesEnd": 2,
        "transitionMode": "direct",
        "twoWay": false,
        "width": 4,
        "speed": 70,
        "align": "center",
        "kind": "road",
        "highwayRules": true,
        "transitionStart": 0,
        "transitionEnd": 1
      }
    },
    {
      "id": "cloverleaf-south-collector-2",
      "name": "南行 · 辅道 3（2车道）",
      "knots": [
        {
          "p": {
            "x": -24,
            "y": 8,
            "z": -82
          },
          "incoming": {
            "x": -24,
            "y": 8,
            "z": -82
          },
          "outgoing": {
            "x": -24,
            "y": 8,
            "z": -27.333333333333336
          },
          "at": 0
        },
        {
          "p": {
            "x": -24,
            "y": 8,
            "z": 82
          },
          "incoming": {
            "x": -24,
            "y": 8,
            "z": 27.333333333333336
          },
          "outgoing": {
            "x": -24,
            "y": 8,
            "z": 82
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 70,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true,
      "attachments": {}
    },
    {
      "id": "cloverleaf-south-collector-3",
      "name": "单车道匝道",
      "knots": [
        {
          "p": {
            "x": -24,
            "y": 8,
            "z": 82
          },
          "incoming": {
            "x": -24,
            "y": 8,
            "z": 82
          },
          "outgoing": {
            "x": -24,
            "y": 8,
            "z": 181.33333333333331
          },
          "at": 0
        },
        {
          "p": {
            "x": -24,
            "y": 8,
            "z": 380
          },
          "incoming": {
            "x": -24,
            "y": 8,
            "z": 280.6666666666667
          },
          "outgoing": {
            "x": -24,
            "y": 8,
            "z": 380
          },
          "at": 1
        }
      ],
      "lanesStart": 1,
      "lanesEnd": 1,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "ramp",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true,
      "attachments": {},
      "sectionOffset": -2,
      "replacedSection": {
        "name": "南行 · 辅道 4（2车道）",
        "lanesStart": 2,
        "lanesEnd": 2,
        "transitionMode": "direct",
        "twoWay": false,
        "width": 4,
        "speed": 70,
        "align": "center",
        "kind": "road",
        "highwayRules": true,
        "transitionStart": 0,
        "transitionEnd": 1
      }
    },
    {
      "id": "cloverleaf-south-collector-4",
      "name": "南行 · 辅道 5（2车道）",
      "knots": [
        {
          "p": {
            "x": -24,
            "y": 8,
            "z": 380
          },
          "incoming": {
            "x": -24,
            "y": 8,
            "z": 380
          },
          "outgoing": {
            "x": -24,
            "y": 8,
            "z": 400
          },
          "at": 0
        },
        {
          "p": {
            "x": -20,
            "y": 8,
            "z": 440
          },
          "incoming": {
            "x": -20,
            "y": 8,
            "z": 420
          },
          "outgoing": {
            "x": -20,
            "y": 8,
            "z": 440
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 70,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true,
      "attachments": {
        "end": {
          "road": "cloverleaf-south-out",
          "end": 0,
          "lanes": [
            2,
            3
          ],
          "ownLanes": [
            0,
            1
          ]
        }
      }
    },
    {
      "id": "cloverleaf-west-in",
      "name": "西行 · 入口（4车道）",
      "knots": [
        {
          "p": {
            "x": 540,
            "y": 0,
            "z": -16
          },
          "incoming": {
            "x": 540,
            "y": 0,
            "z": -16
          },
          "outgoing": {
            "x": 506.66666666666674,
            "y": 0,
            "z": -16
          },
          "at": 0
        },
        {
          "p": {
            "x": 440,
            "y": 0,
            "z": -16
          },
          "incoming": {
            "x": 473.33333333333337,
            "y": 0,
            "z": -16
          },
          "outgoing": {
            "x": 440,
            "y": 0,
            "z": -16
          },
          "at": 1
        }
      ],
      "lanesStart": 4,
      "lanesEnd": 4,
      "twoWay": false,
      "width": 4,
      "speed": 100,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true
    },
    {
      "id": "cloverleaf-west-out",
      "name": "西行 · 出口（4车道）",
      "knots": [
        {
          "p": {
            "x": -440,
            "y": 0,
            "z": -16
          },
          "incoming": {
            "x": -440,
            "y": 0,
            "z": -16
          },
          "outgoing": {
            "x": -473.33333333333337,
            "y": 0,
            "z": -16
          },
          "at": 0
        },
        {
          "p": {
            "x": -540,
            "y": 0,
            "z": -16
          },
          "incoming": {
            "x": -506.6666666666667,
            "y": 0,
            "z": -16
          },
          "outgoing": {
            "x": -540,
            "y": 0,
            "z": -16
          },
          "at": 1
        }
      ],
      "lanesStart": 4,
      "lanesEnd": 4,
      "twoWay": false,
      "width": 4,
      "speed": 100,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true
    },
    {
      "id": "cloverleaf-west-collector-0",
      "name": "西行 · 辅道 1（2车道）",
      "knots": [
        {
          "p": {
            "x": 440,
            "y": 0,
            "z": -20
          },
          "incoming": {
            "x": 440,
            "y": 0,
            "z": -20
          },
          "outgoing": {
            "x": 420,
            "y": 0,
            "z": -20
          },
          "at": 0
        },
        {
          "p": {
            "x": 380,
            "y": 0,
            "z": -24
          },
          "incoming": {
            "x": 400,
            "y": 0,
            "z": -24
          },
          "outgoing": {
            "x": 380,
            "y": 0,
            "z": -24
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 70,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true,
      "attachments": {
        "start": {
          "road": "cloverleaf-west-in",
          "end": 1,
          "lanes": [
            2,
            3
          ],
          "ownLanes": [
            0,
            1
          ]
        }
      }
    },
    {
      "id": "cloverleaf-west-collector-1",
      "name": "单车道匝道",
      "knots": [
        {
          "p": {
            "x": 380,
            "y": 0,
            "z": -24
          },
          "incoming": {
            "x": 380,
            "y": 0,
            "z": -24
          },
          "outgoing": {
            "x": 280.6666666666667,
            "y": 0,
            "z": -24
          },
          "at": 0
        },
        {
          "p": {
            "x": 82,
            "y": 0,
            "z": -24
          },
          "incoming": {
            "x": 181.33333333333331,
            "y": 0,
            "z": -24
          },
          "outgoing": {
            "x": 82,
            "y": 0,
            "z": -24
          },
          "at": 1
        }
      ],
      "lanesStart": 1,
      "lanesEnd": 1,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "ramp",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true,
      "attachments": {},
      "sectionOffset": -2,
      "replacedSection": {
        "name": "西行 · 辅道 2（2车道）",
        "lanesStart": 2,
        "lanesEnd": 2,
        "transitionMode": "direct",
        "twoWay": false,
        "width": 4,
        "speed": 70,
        "align": "center",
        "kind": "road",
        "highwayRules": true,
        "transitionStart": 0,
        "transitionEnd": 1
      }
    },
    {
      "id": "cloverleaf-west-collector-2",
      "name": "西行 · 辅道 3（2车道）",
      "knots": [
        {
          "p": {
            "x": 82,
            "y": 0,
            "z": -24
          },
          "incoming": {
            "x": 82,
            "y": 0,
            "z": -24
          },
          "outgoing": {
            "x": 27.333333333333336,
            "y": 0,
            "z": -24
          },
          "at": 0
        },
        {
          "p": {
            "x": -82,
            "y": 0,
            "z": -24
          },
          "incoming": {
            "x": -27.333333333333336,
            "y": 0,
            "z": -24
          },
          "outgoing": {
            "x": -82,
            "y": 0,
            "z": -24
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 70,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true,
      "attachments": {}
    },
    {
      "id": "cloverleaf-west-collector-3",
      "name": "单车道匝道",
      "knots": [
        {
          "p": {
            "x": -82,
            "y": 0,
            "z": -24
          },
          "incoming": {
            "x": -82,
            "y": 0,
            "z": -24
          },
          "outgoing": {
            "x": -181.33333333333331,
            "y": 0,
            "z": -24
          },
          "at": 0
        },
        {
          "p": {
            "x": -380,
            "y": 0,
            "z": -24
          },
          "incoming": {
            "x": -280.6666666666667,
            "y": 0,
            "z": -24
          },
          "outgoing": {
            "x": -380,
            "y": 0,
            "z": -24
          },
          "at": 1
        }
      ],
      "lanesStart": 1,
      "lanesEnd": 1,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "ramp",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true,
      "attachments": {},
      "sectionOffset": -2,
      "replacedSection": {
        "name": "西行 · 辅道 4（2车道）",
        "lanesStart": 2,
        "lanesEnd": 2,
        "transitionMode": "direct",
        "twoWay": false,
        "width": 4,
        "speed": 70,
        "align": "center",
        "kind": "road",
        "highwayRules": true,
        "transitionStart": 0,
        "transitionEnd": 1
      }
    },
    {
      "id": "cloverleaf-west-collector-4",
      "name": "西行 · 辅道 5（2车道）",
      "knots": [
        {
          "p": {
            "x": -380,
            "y": 0,
            "z": -24
          },
          "incoming": {
            "x": -380,
            "y": 0,
            "z": -24
          },
          "outgoing": {
            "x": -400,
            "y": 0,
            "z": -24
          },
          "at": 0
        },
        {
          "p": {
            "x": -440,
            "y": 0,
            "z": -20
          },
          "incoming": {
            "x": -420,
            "y": 0,
            "z": -20
          },
          "outgoing": {
            "x": -440,
            "y": 0,
            "z": -20
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 70,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true,
      "attachments": {
        "end": {
          "road": "cloverleaf-west-out",
          "end": 0,
          "lanes": [
            2,
            3
          ],
          "ownLanes": [
            0,
            1
          ]
        }
      }
    },
    {
      "id": "cloverleaf-north-in",
      "name": "北行 · 入口（4车道）",
      "knots": [
        {
          "p": {
            "x": 16,
            "y": 8,
            "z": 540
          },
          "incoming": {
            "x": 16,
            "y": 8,
            "z": 540
          },
          "outgoing": {
            "x": 16,
            "y": 8,
            "z": 506.66666666666674
          },
          "at": 0
        },
        {
          "p": {
            "x": 16,
            "y": 8,
            "z": 440
          },
          "incoming": {
            "x": 16,
            "y": 8,
            "z": 473.33333333333337
          },
          "outgoing": {
            "x": 16,
            "y": 8,
            "z": 440
          },
          "at": 1
        }
      ],
      "lanesStart": 4,
      "lanesEnd": 4,
      "twoWay": false,
      "width": 4,
      "speed": 100,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true
    },
    {
      "id": "cloverleaf-north-out",
      "name": "北行 · 出口（4车道）",
      "knots": [
        {
          "p": {
            "x": 16,
            "y": 8,
            "z": -440
          },
          "incoming": {
            "x": 16,
            "y": 8,
            "z": -440
          },
          "outgoing": {
            "x": 16,
            "y": 8,
            "z": -473.33333333333337
          },
          "at": 0
        },
        {
          "p": {
            "x": 16,
            "y": 8,
            "z": -540
          },
          "incoming": {
            "x": 16,
            "y": 8,
            "z": -506.6666666666667
          },
          "outgoing": {
            "x": 16,
            "y": 8,
            "z": -540
          },
          "at": 1
        }
      ],
      "lanesStart": 4,
      "lanesEnd": 4,
      "twoWay": false,
      "width": 4,
      "speed": 100,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true
    },
    {
      "id": "cloverleaf-north-collector-0",
      "name": "北行 · 辅道 1（2车道）",
      "knots": [
        {
          "p": {
            "x": 20,
            "y": 8,
            "z": 440
          },
          "incoming": {
            "x": 20,
            "y": 8,
            "z": 440
          },
          "outgoing": {
            "x": 20,
            "y": 8,
            "z": 420
          },
          "at": 0
        },
        {
          "p": {
            "x": 24,
            "y": 8,
            "z": 380
          },
          "incoming": {
            "x": 24,
            "y": 8,
            "z": 400
          },
          "outgoing": {
            "x": 24,
            "y": 8,
            "z": 380
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 70,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true,
      "attachments": {
        "start": {
          "road": "cloverleaf-north-in",
          "end": 1,
          "lanes": [
            2,
            3
          ],
          "ownLanes": [
            0,
            1
          ]
        }
      }
    },
    {
      "id": "cloverleaf-north-collector-1",
      "name": "单车道匝道",
      "knots": [
        {
          "p": {
            "x": 24,
            "y": 8,
            "z": 380
          },
          "incoming": {
            "x": 24,
            "y": 8,
            "z": 380
          },
          "outgoing": {
            "x": 24,
            "y": 8,
            "z": 280.6666666666667
          },
          "at": 0
        },
        {
          "p": {
            "x": 24,
            "y": 8,
            "z": 82
          },
          "incoming": {
            "x": 24,
            "y": 8,
            "z": 181.33333333333331
          },
          "outgoing": {
            "x": 24,
            "y": 8,
            "z": 82
          },
          "at": 1
        }
      ],
      "lanesStart": 1,
      "lanesEnd": 1,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "ramp",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true,
      "attachments": {},
      "sectionOffset": -2,
      "replacedSection": {
        "name": "北行 · 辅道 2（2车道）",
        "lanesStart": 2,
        "lanesEnd": 2,
        "transitionMode": "direct",
        "twoWay": false,
        "width": 4,
        "speed": 70,
        "align": "center",
        "kind": "road",
        "highwayRules": true,
        "transitionStart": 0,
        "transitionEnd": 1
      }
    },
    {
      "id": "cloverleaf-north-collector-2",
      "name": "北行 · 辅道 3（2车道）",
      "knots": [
        {
          "p": {
            "x": 24,
            "y": 8,
            "z": 82
          },
          "incoming": {
            "x": 24,
            "y": 8,
            "z": 82
          },
          "outgoing": {
            "x": 24,
            "y": 8,
            "z": 27.333333333333336
          },
          "at": 0
        },
        {
          "p": {
            "x": 24,
            "y": 8,
            "z": -82
          },
          "incoming": {
            "x": 24,
            "y": 8,
            "z": -27.333333333333336
          },
          "outgoing": {
            "x": 24,
            "y": 8,
            "z": -82
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 70,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true,
      "attachments": {}
    },
    {
      "id": "cloverleaf-north-collector-3",
      "name": "单车道匝道",
      "knots": [
        {
          "p": {
            "x": 24,
            "y": 8,
            "z": -82
          },
          "incoming": {
            "x": 24,
            "y": 8,
            "z": -82
          },
          "outgoing": {
            "x": 24,
            "y": 8,
            "z": -181.33333333333331
          },
          "at": 0
        },
        {
          "p": {
            "x": 24,
            "y": 8,
            "z": -380
          },
          "incoming": {
            "x": 24,
            "y": 8,
            "z": -280.6666666666667
          },
          "outgoing": {
            "x": 24,
            "y": 8,
            "z": -380
          },
          "at": 1
        }
      ],
      "lanesStart": 1,
      "lanesEnd": 1,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "ramp",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true,
      "attachments": {},
      "sectionOffset": -2,
      "replacedSection": {
        "name": "北行 · 辅道 4（2车道）",
        "lanesStart": 2,
        "lanesEnd": 2,
        "transitionMode": "direct",
        "twoWay": false,
        "width": 4,
        "speed": 70,
        "align": "center",
        "kind": "road",
        "highwayRules": true,
        "transitionStart": 0,
        "transitionEnd": 1
      }
    },
    {
      "id": "cloverleaf-north-collector-4",
      "name": "北行 · 辅道 5（2车道）",
      "knots": [
        {
          "p": {
            "x": 24,
            "y": 8,
            "z": -380
          },
          "incoming": {
            "x": 24,
            "y": 8,
            "z": -380
          },
          "outgoing": {
            "x": 24,
            "y": 8,
            "z": -400
          },
          "at": 0
        },
        {
          "p": {
            "x": 20,
            "y": 8,
            "z": -440
          },
          "incoming": {
            "x": 20,
            "y": 8,
            "z": -420
          },
          "outgoing": {
            "x": 20,
            "y": 8,
            "z": -440
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 70,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true,
      "attachments": {
        "end": {
          "road": "cloverleaf-north-out",
          "end": 0,
          "lanes": [
            2,
            3
          ],
          "ownLanes": [
            0,
            1
          ]
        }
      }
    },
    {
      "id": "cloverleaf-east-left",
      "name": "东行 → 北行 · 苜蓿叶环形匝道",
      "knots": [
        {
          "p": {
            "x": 82,
            "y": 0,
            "z": 26
          },
          "incoming": {
            "x": 82,
            "y": 0,
            "z": 26
          },
          "outgoing": {
            "x": 91.38225019760978,
            "y": 0,
            "z": 26
          },
          "at": 0
        },
        {
          "p": {
            "x": 108.84783016183538,
            "y": 0,
            "z": 32.85537653413913
          },
          "incoming": {
            "x": 100.61413099712053,
            "y": 0,
            "z": 28.357286179830673
          },
          "outgoing": {
            "x": 126.82051372933492,
            "y": 0,
            "z": 42.67389831623871
          },
          "at": 0.10610329539459688
        },
        {
          "p": {
            "x": 138,
            "y": 1.6127691309254504,
            "z": 82
          },
          "incoming": {
            "x": 138,
            "y": 0.6655746657363653,
            "z": 61.52023621710856
          },
          "outgoing": {
            "x": 138,
            "y": 3.002248670076371,
            "z": 112.92794599052444
          },
          "at": 0.3333333333333333
        },
        {
          "p": {
            "x": 82,
            "y": 6.38723086907455,
            "z": 138
          },
          "incoming": {
            "x": 112.92794599052444,
            "y": 4.99775132992363,
            "z": 138
          },
          "outgoing": {
            "x": 61.52023621710855,
            "y": 7.334425334263635,
            "z": 138
          },
          "at": 0.6666666666666666
        },
        {
          "p": {
            "x": 32.85537653413913,
            "y": 8,
            "z": 108.84783016183538
          },
          "incoming": {
            "x": 42.67389831623872,
            "y": 8,
            "z": 126.82051372933492
          },
          "outgoing": {
            "x": 28.357286179830677,
            "y": 8,
            "z": 100.61413099712054
          },
          "at": 0.8938967046054032
        },
        {
          "p": {
            "x": 26,
            "y": 8,
            "z": 82
          },
          "incoming": {
            "x": 26,
            "y": 8,
            "z": 91.38225019760978
          },
          "outgoing": {
            "x": 26,
            "y": 8,
            "z": 82
          },
          "at": 1
        }
      ],
      "lanesStart": 1,
      "lanesEnd": 1,
      "twoWay": false,
      "width": 4,
      "speed": 35,
      "align": "center",
      "kind": "ramp",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true,
      "attachments": {
        "start": {
          "road": "cloverleaf-east-collector-2",
          "end": 1,
          "lanes": [
            1
          ],
          "ownLanes": [
            0
          ]
        },
        "end": {
          "road": "cloverleaf-north-collector-2",
          "end": 0,
          "lanes": [
            1
          ],
          "ownLanes": [
            0
          ]
        }
      }
    },
    {
      "id": "cloverleaf-east-right",
      "name": "东行 → 南行 · 外侧右转匝道",
      "knots": [
        {
          "p": {
            "x": -380,
            "y": 0,
            "z": 26
          },
          "incoming": {
            "x": -380,
            "y": 0,
            "z": 26
          },
          "outgoing": {
            "x": -358.65212795474616,
            "y": 0,
            "z": 26
          },
          "at": 0
        },
        {
          "p": {
            "x": -316.34807462674405,
            "y": 0,
            "z": 31.769569973734974
          },
          "incoming": {
            "x": -337.34801435121983,
            "y": 0,
            "z": 27.931058227118267
          },
          "outgoing": {
            "x": -171.54825087557035,
            "y": 0,
            "z": 58.237066150835744
          },
          "at": 0.11509510008905426
        },
        {
          "p": {
            "x": -31.769569973734974,
            "y": 8,
            "z": 316.3480746267441
          },
          "incoming": {
            "x": -58.2370661508357,
            "y": 8,
            "z": 171.54825087557037
          },
          "outgoing": {
            "x": -27.931058227118275,
            "y": 8,
            "z": 337.3480143512199
          },
          "at": 0.8849048999109458
        },
        {
          "p": {
            "x": -26,
            "y": 8,
            "z": 380
          },
          "incoming": {
            "x": -26,
            "y": 8,
            "z": 358.65212795474616
          },
          "outgoing": {
            "x": -26,
            "y": 8,
            "z": 380
          },
          "at": 1
        }
      ],
      "lanesStart": 1,
      "lanesEnd": 1,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "ramp",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true,
      "attachments": {
        "start": {
          "road": "cloverleaf-east-collector-0",
          "end": 1,
          "lanes": [
            1
          ],
          "ownLanes": [
            0
          ]
        },
        "end": {
          "road": "cloverleaf-south-collector-4",
          "end": 0,
          "lanes": [
            1
          ],
          "ownLanes": [
            0
          ]
        }
      }
    },
    {
      "id": "cloverleaf-south-left",
      "name": "南行 → 东行 · 苜蓿叶环形匝道",
      "knots": [
        {
          "p": {
            "x": -26,
            "y": 8,
            "z": 82
          },
          "incoming": {
            "x": -26,
            "y": 8,
            "z": 82
          },
          "outgoing": {
            "x": -26,
            "y": 8,
            "z": 91.38225019760978
          },
          "at": 0
        },
        {
          "p": {
            "x": -32.85537653413913,
            "y": 8,
            "z": 108.84783016183538
          },
          "incoming": {
            "x": -28.357286179830673,
            "y": 8,
            "z": 100.61413099712053
          },
          "outgoing": {
            "x": -42.67389831623871,
            "y": 8,
            "z": 126.82051372933492
          },
          "at": 0.10610329539459688
        },
        {
          "p": {
            "x": -82,
            "y": 6.38723086907455,
            "z": 138
          },
          "incoming": {
            "x": -61.52023621710856,
            "y": 7.334425334263635,
            "z": 138
          },
          "outgoing": {
            "x": -112.92794599052444,
            "y": 4.997751329923629,
            "z": 138
          },
          "at": 0.3333333333333333
        },
        {
          "p": {
            "x": -138,
            "y": 1.6127691309254502,
            "z": 82
          },
          "incoming": {
            "x": -138,
            "y": 3.00224867007637,
            "z": 112.92794599052444
          },
          "outgoing": {
            "x": -138,
            "y": 0.6655746657363647,
            "z": 61.52023621710855
          },
          "at": 0.6666666666666666
        },
        {
          "p": {
            "x": -108.84783016183538,
            "y": 0,
            "z": 32.85537653413913
          },
          "incoming": {
            "x": -126.82051372933492,
            "y": 0,
            "z": 42.67389831623872
          },
          "outgoing": {
            "x": -100.61413099712054,
            "y": 0,
            "z": 28.357286179830677
          },
          "at": 0.8938967046054032
        },
        {
          "p": {
            "x": -82,
            "y": 0,
            "z": 26
          },
          "incoming": {
            "x": -91.38225019760978,
            "y": 0,
            "z": 26
          },
          "outgoing": {
            "x": -82,
            "y": 0,
            "z": 26
          },
          "at": 1
        }
      ],
      "lanesStart": 1,
      "lanesEnd": 1,
      "twoWay": false,
      "width": 4,
      "speed": 35,
      "align": "center",
      "kind": "ramp",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true,
      "attachments": {
        "start": {
          "road": "cloverleaf-south-collector-2",
          "end": 1,
          "lanes": [
            1
          ],
          "ownLanes": [
            0
          ]
        },
        "end": {
          "road": "cloverleaf-east-collector-2",
          "end": 0,
          "lanes": [
            1
          ],
          "ownLanes": [
            0
          ]
        }
      }
    },
    {
      "id": "cloverleaf-south-right",
      "name": "南行 → 西行 · 外侧右转匝道",
      "knots": [
        {
          "p": {
            "x": -26,
            "y": 8,
            "z": -380
          },
          "incoming": {
            "x": -26,
            "y": 8,
            "z": -380
          },
          "outgoing": {
            "x": -26,
            "y": 8,
            "z": -358.65212795474616
          },
          "at": 0
        },
        {
          "p": {
            "x": -31.769569973734974,
            "y": 8,
            "z": -316.34807462674405
          },
          "incoming": {
            "x": -27.931058227118267,
            "y": 8,
            "z": -337.34801435121983
          },
          "outgoing": {
            "x": -58.237066150835744,
            "y": 8,
            "z": -171.54825087557035
          },
          "at": 0.11509510008905426
        },
        {
          "p": {
            "x": -316.3480746267441,
            "y": 0,
            "z": -31.769569973734974
          },
          "incoming": {
            "x": -171.54825087557037,
            "y": 0,
            "z": -58.2370661508357
          },
          "outgoing": {
            "x": -337.3480143512199,
            "y": 0,
            "z": -27.931058227118275
          },
          "at": 0.8849048999109458
        },
        {
          "p": {
            "x": -380,
            "y": 0,
            "z": -26
          },
          "incoming": {
            "x": -358.65212795474616,
            "y": 0,
            "z": -26
          },
          "outgoing": {
            "x": -380,
            "y": 0,
            "z": -26
          },
          "at": 1
        }
      ],
      "lanesStart": 1,
      "lanesEnd": 1,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "ramp",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true,
      "attachments": {
        "start": {
          "road": "cloverleaf-south-collector-0",
          "end": 1,
          "lanes": [
            1
          ],
          "ownLanes": [
            0
          ]
        },
        "end": {
          "road": "cloverleaf-west-collector-4",
          "end": 0,
          "lanes": [
            1
          ],
          "ownLanes": [
            0
          ]
        }
      }
    },
    {
      "id": "cloverleaf-west-left",
      "name": "西行 → 南行 · 苜蓿叶环形匝道",
      "knots": [
        {
          "p": {
            "x": -82,
            "y": 0,
            "z": -26
          },
          "incoming": {
            "x": -82,
            "y": 0,
            "z": -26
          },
          "outgoing": {
            "x": -91.38225019760978,
            "y": 0,
            "z": -26
          },
          "at": 0
        },
        {
          "p": {
            "x": -108.84783016183538,
            "y": 0,
            "z": -32.85537653413913
          },
          "incoming": {
            "x": -100.61413099712053,
            "y": 0,
            "z": -28.357286179830673
          },
          "outgoing": {
            "x": -126.82051372933492,
            "y": 0,
            "z": -42.67389831623871
          },
          "at": 0.10610329539459688
        },
        {
          "p": {
            "x": -138,
            "y": 1.6127691309254504,
            "z": -82
          },
          "incoming": {
            "x": -138,
            "y": 0.6655746657363653,
            "z": -61.52023621710856
          },
          "outgoing": {
            "x": -138,
            "y": 3.002248670076371,
            "z": -112.92794599052444
          },
          "at": 0.3333333333333333
        },
        {
          "p": {
            "x": -82,
            "y": 6.38723086907455,
            "z": -138
          },
          "incoming": {
            "x": -112.92794599052444,
            "y": 4.99775132992363,
            "z": -138
          },
          "outgoing": {
            "x": -61.52023621710855,
            "y": 7.334425334263635,
            "z": -138
          },
          "at": 0.6666666666666666
        },
        {
          "p": {
            "x": -32.85537653413913,
            "y": 8,
            "z": -108.84783016183538
          },
          "incoming": {
            "x": -42.67389831623872,
            "y": 8,
            "z": -126.82051372933492
          },
          "outgoing": {
            "x": -28.357286179830677,
            "y": 8,
            "z": -100.61413099712054
          },
          "at": 0.8938967046054032
        },
        {
          "p": {
            "x": -26,
            "y": 8,
            "z": -82
          },
          "incoming": {
            "x": -26,
            "y": 8,
            "z": -91.38225019760978
          },
          "outgoing": {
            "x": -26,
            "y": 8,
            "z": -82
          },
          "at": 1
        }
      ],
      "lanesStart": 1,
      "lanesEnd": 1,
      "twoWay": false,
      "width": 4,
      "speed": 35,
      "align": "center",
      "kind": "ramp",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true,
      "attachments": {
        "start": {
          "road": "cloverleaf-west-collector-2",
          "end": 1,
          "lanes": [
            1
          ],
          "ownLanes": [
            0
          ]
        },
        "end": {
          "road": "cloverleaf-south-collector-2",
          "end": 0,
          "lanes": [
            1
          ],
          "ownLanes": [
            0
          ]
        }
      }
    },
    {
      "id": "cloverleaf-west-right",
      "name": "西行 → 北行 · 外侧右转匝道",
      "knots": [
        {
          "p": {
            "x": 380,
            "y": 0,
            "z": -26
          },
          "incoming": {
            "x": 380,
            "y": 0,
            "z": -26
          },
          "outgoing": {
            "x": 358.65212795474616,
            "y": 0,
            "z": -26
          },
          "at": 0
        },
        {
          "p": {
            "x": 316.34807462674405,
            "y": 0,
            "z": -31.769569973734974
          },
          "incoming": {
            "x": 337.34801435121983,
            "y": 0,
            "z": -27.931058227118267
          },
          "outgoing": {
            "x": 171.54825087557035,
            "y": 0,
            "z": -58.237066150835744
          },
          "at": 0.11509510008905426
        },
        {
          "p": {
            "x": 31.769569973734974,
            "y": 8,
            "z": -316.3480746267441
          },
          "incoming": {
            "x": 58.2370661508357,
            "y": 8,
            "z": -171.54825087557037
          },
          "outgoing": {
            "x": 27.931058227118275,
            "y": 8,
            "z": -337.3480143512199
          },
          "at": 0.8849048999109458
        },
        {
          "p": {
            "x": 26,
            "y": 8,
            "z": -380
          },
          "incoming": {
            "x": 26,
            "y": 8,
            "z": -358.65212795474616
          },
          "outgoing": {
            "x": 26,
            "y": 8,
            "z": -380
          },
          "at": 1
        }
      ],
      "lanesStart": 1,
      "lanesEnd": 1,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "ramp",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true,
      "attachments": {
        "start": {
          "road": "cloverleaf-west-collector-0",
          "end": 1,
          "lanes": [
            1
          ],
          "ownLanes": [
            0
          ]
        },
        "end": {
          "road": "cloverleaf-north-collector-4",
          "end": 0,
          "lanes": [
            1
          ],
          "ownLanes": [
            0
          ]
        }
      }
    },
    {
      "id": "cloverleaf-north-left",
      "name": "北行 → 西行 · 苜蓿叶环形匝道",
      "knots": [
        {
          "p": {
            "x": 26,
            "y": 8,
            "z": -82
          },
          "incoming": {
            "x": 26,
            "y": 8,
            "z": -82
          },
          "outgoing": {
            "x": 26,
            "y": 8,
            "z": -91.38225019760978
          },
          "at": 0
        },
        {
          "p": {
            "x": 32.85537653413913,
            "y": 8,
            "z": -108.84783016183538
          },
          "incoming": {
            "x": 28.357286179830673,
            "y": 8,
            "z": -100.61413099712053
          },
          "outgoing": {
            "x": 42.67389831623871,
            "y": 8,
            "z": -126.82051372933492
          },
          "at": 0.10610329539459688
        },
        {
          "p": {
            "x": 82,
            "y": 6.38723086907455,
            "z": -138
          },
          "incoming": {
            "x": 61.52023621710856,
            "y": 7.334425334263635,
            "z": -138
          },
          "outgoing": {
            "x": 112.92794599052444,
            "y": 4.997751329923629,
            "z": -138
          },
          "at": 0.3333333333333333
        },
        {
          "p": {
            "x": 138,
            "y": 1.6127691309254502,
            "z": -82
          },
          "incoming": {
            "x": 138,
            "y": 3.00224867007637,
            "z": -112.92794599052444
          },
          "outgoing": {
            "x": 138,
            "y": 0.6655746657363647,
            "z": -61.52023621710855
          },
          "at": 0.6666666666666666
        },
        {
          "p": {
            "x": 108.84783016183538,
            "y": 0,
            "z": -32.85537653413913
          },
          "incoming": {
            "x": 126.82051372933492,
            "y": 0,
            "z": -42.67389831623872
          },
          "outgoing": {
            "x": 100.61413099712054,
            "y": 0,
            "z": -28.357286179830677
          },
          "at": 0.8938967046054032
        },
        {
          "p": {
            "x": 82,
            "y": 0,
            "z": -26
          },
          "incoming": {
            "x": 91.38225019760978,
            "y": 0,
            "z": -26
          },
          "outgoing": {
            "x": 82,
            "y": 0,
            "z": -26
          },
          "at": 1
        }
      ],
      "lanesStart": 1,
      "lanesEnd": 1,
      "twoWay": false,
      "width": 4,
      "speed": 35,
      "align": "center",
      "kind": "ramp",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true,
      "attachments": {
        "start": {
          "road": "cloverleaf-north-collector-2",
          "end": 1,
          "lanes": [
            1
          ],
          "ownLanes": [
            0
          ]
        },
        "end": {
          "road": "cloverleaf-west-collector-2",
          "end": 0,
          "lanes": [
            1
          ],
          "ownLanes": [
            0
          ]
        }
      }
    },
    {
      "id": "cloverleaf-north-right",
      "name": "北行 → 东行 · 外侧右转匝道",
      "knots": [
        {
          "p": {
            "x": 26,
            "y": 8,
            "z": 380
          },
          "incoming": {
            "x": 26,
            "y": 8,
            "z": 380
          },
          "outgoing": {
            "x": 26,
            "y": 8,
            "z": 358.65212795474616
          },
          "at": 0
        },
        {
          "p": {
            "x": 31.769569973734974,
            "y": 8,
            "z": 316.34807462674405
          },
          "incoming": {
            "x": 27.931058227118267,
            "y": 8,
            "z": 337.34801435121983
          },
          "outgoing": {
            "x": 58.237066150835744,
            "y": 8,
            "z": 171.54825087557035
          },
          "at": 0.11509510008905426
        },
        {
          "p": {
            "x": 316.3480746267441,
            "y": 0,
            "z": 31.769569973734974
          },
          "incoming": {
            "x": 171.54825087557037,
            "y": 0,
            "z": 58.2370661508357
          },
          "outgoing": {
            "x": 337.3480143512199,
            "y": 0,
            "z": 27.931058227118275
          },
          "at": 0.8849048999109458
        },
        {
          "p": {
            "x": 380,
            "y": 0,
            "z": 26
          },
          "incoming": {
            "x": 358.65212795474616,
            "y": 0,
            "z": 26
          },
          "outgoing": {
            "x": 380,
            "y": 0,
            "z": 26
          },
          "at": 1
        }
      ],
      "lanesStart": 1,
      "lanesEnd": 1,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "ramp",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "highwayRules": true,
      "attachments": {
        "start": {
          "road": "cloverleaf-north-collector-0",
          "end": 1,
          "lanes": [
            1
          ],
          "ownLanes": [
            0
          ]
        },
        "end": {
          "road": "cloverleaf-east-collector-4",
          "end": 0,
          "lanes": [
            1
          ],
          "ownLanes": [
            0
          ]
        }
      }
    },
    {
      "id": "r-mw7iqyk9-hg0",
      "name": "单向两车道",
      "knots": [
        {
          "p": {
            "x": 12,
            "y": 8,
            "z": 440
          },
          "incoming": {
            "x": 12,
            "y": 8,
            "z": 440
          },
          "outgoing": {
            "x": 12,
            "y": 8,
            "z": 431.2987062030651
          },
          "at": 0
        },
        {
          "p": {
            "x": 12,
            "y": 8,
            "z": 330.00488941546905
          },
          "incoming": {
            "x": 12,
            "y": 8,
            "z": 390.66424208802914
          },
          "outgoing": {
            "x": 12,
            "y": 8,
            "z": 298.2546095307805
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 8,
      "endHeight": 8,
      "highwayRules": false,
      "attachments": {
        "start": {
          "road": "cloverleaf-north-in",
          "end": 1,
          "lanes": [
            0,
            1
          ],
          "ownLanes": [
            0,
            1
          ]
        }
      }
    },
    {
      "id": "r-mw7iqykh-hg3",
      "name": "单向两车道 · 后段",
      "knots": [
        {
          "p": {
            "x": 12,
            "y": 8,
            "z": 330.00488941546905
          },
          "incoming": {
            "x": 12,
            "y": 8,
            "z": 390.66424208802914
          },
          "outgoing": {
            "x": 12,
            "y": 8,
            "z": 298.2546095307805
          },
          "at": 0
        },
        {
          "p": {
            "x": 12,
            "y": 8,
            "z": 220.00317226539272
          },
          "incoming": {
            "x": 12,
            "y": 8,
            "z": 261.01815433930824
          },
          "outgoing": {
            "x": 12,
            "y": 8,
            "z": 154.06909890134642
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 8,
      "endHeight": 8,
      "highwayRules": false,
      "attachments": {}
    },
    {
      "id": "r-mw7iqykh-hg2",
      "name": "单向两车道 · 后段",
      "knots": [
        {
          "p": {
            "x": 12,
            "y": 8,
            "z": 220.00317226539272
          },
          "incoming": {
            "x": 12,
            "y": 8,
            "z": 339.37784979762057
          },
          "outgoing": {
            "x": 12,
            "y": 8,
            "z": 185.6523188943746
          },
          "at": 0
        },
        {
          "p": {
            "x": 12,
            "y": 8,
            "z": 110.00258261505346
          },
          "incoming": {
            "x": 12,
            "y": 8,
            "z": 148.6510587945722
          },
          "outgoing": {
            "x": 12,
            "y": 8,
            "z": 74.46799742181025
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 8,
      "endHeight": 8,
      "highwayRules": false,
      "attachments": {}
    },
    {
      "id": "r-mw7iqykh-hg4",
      "name": "单向两车道 · 后段 · 后段",
      "knots": [
        {
          "p": {
            "x": 12,
            "y": 8,
            "z": 110.00258261505346
          },
          "incoming": {
            "x": 12,
            "y": 8,
            "z": 148.6510587945722
          },
          "outgoing": {
            "x": 12,
            "y": 8,
            "z": 74.46799742181025
          },
          "at": 0
        },
        {
          "p": {
            "x": 12,
            "y": 8,
            "z": 0.0011157845592464355
          },
          "incoming": {
            "x": 12,
            "y": 8,
            "z": 37.54093429181205
          },
          "outgoing": {
            "x": 12,
            "y": 8,
            "z": -154.37964998617946
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 8,
      "endHeight": 8,
      "highwayRules": false,
      "attachments": {}
    },
    {
      "id": "r-mw7iqykg-hg1",
      "name": "单向两车道 · 后段",
      "knots": [
        {
          "p": {
            "x": 12,
            "y": 8,
            "z": 0.0011157845592464355
          },
          "incoming": {
            "x": 12,
            "y": 8,
            "z": 220.2591160133976
          },
          "outgoing": {
            "x": 12,
            "y": 8,
            "z": -36.32762846717864
          },
          "at": 0
        },
        {
          "p": {
            "x": 12,
            "y": 8,
            "z": -110.00002060085416
          },
          "incoming": {
            "x": 12,
            "y": 8,
            "z": -73.23022956385732
          },
          "outgoing": {
            "x": 12,
            "y": 8,
            "z": -147.04287354749655
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 8,
      "endHeight": 8,
      "highwayRules": false,
      "attachments": {}
    },
    {
      "id": "r-mw7iqyki-hg6",
      "name": "单向两车道 · 后段 · 后段",
      "knots": [
        {
          "p": {
            "x": 12,
            "y": 8,
            "z": -110.00002060085416
          },
          "incoming": {
            "x": 12,
            "y": 8,
            "z": -73.23022956385732
          },
          "outgoing": {
            "x": 12,
            "y": 8,
            "z": -147.04287354749655
          },
          "at": 0
        },
        {
          "p": {
            "x": 12,
            "y": 8,
            "z": -220.00168181873613
          },
          "incoming": {
            "x": 12,
            "y": 8,
            "z": -183.95093654686679
          },
          "outgoing": {
            "x": 12,
            "y": 8,
            "z": -300.23602394099487
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 8,
      "endHeight": 8,
      "highwayRules": false,
      "attachments": {}
    },
    {
      "id": "r-mw7iqyki-hg5",
      "name": "单向两车道 · 后段 · 后段",
      "knots": [
        {
          "p": {
            "x": 12,
            "y": 8,
            "z": -220.00168181873613
          },
          "incoming": {
            "x": 12,
            "y": 8,
            "z": -148.16593984901417
          },
          "outgoing": {
            "x": 12,
            "y": 8,
            "z": -257.89487651863055
          },
          "at": 0
        },
        {
          "p": {
            "x": 12,
            "y": 8,
            "z": -330.0006400233516
          },
          "incoming": {
            "x": 12,
            "y": 8,
            "z": -294.8408841673943
          },
          "outgoing": {
            "x": 12,
            "y": 8,
            "z": -369.28749397751494
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 8,
      "endHeight": 8,
      "highwayRules": false,
      "attachments": {}
    },
    {
      "id": "r-mw7iqyki-hg7",
      "name": "单向两车道 · 后段 · 后段 · 后段",
      "knots": [
        {
          "p": {
            "x": 12,
            "y": 8,
            "z": -330.0006400233516
          },
          "incoming": {
            "x": 12,
            "y": 8,
            "z": -294.8408841673943
          },
          "outgoing": {
            "x": 12,
            "y": 8,
            "z": -369.28749397751494
          },
          "at": 0
        },
        {
          "p": {
            "x": 12,
            "y": 8,
            "z": -440
          },
          "incoming": {
            "x": 12,
            "y": 8,
            "z": -406.3441393581827
          },
          "outgoing": {
            "x": 12,
            "y": 8,
            "z": -440
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 8,
      "endHeight": 8,
      "highwayRules": false,
      "attachments": {
        "end": {
          "road": "cloverleaf-north-out",
          "end": 0,
          "lanes": [
            0,
            1
          ],
          "ownLanes": [
            0,
            1
          ]
        }
      }
    },
    {
      "id": "r-mw7ir2gu-on8",
      "name": "单向两车道",
      "knots": [
        {
          "p": {
            "x": -12,
            "y": 8,
            "z": -440
          },
          "incoming": {
            "x": -12,
            "y": 8,
            "z": -440
          },
          "outgoing": {
            "x": -12,
            "y": 8,
            "z": -431.2987062030651
          },
          "at": 0
        },
        {
          "p": {
            "x": -12,
            "y": 8,
            "z": -330.00488941546905
          },
          "incoming": {
            "x": -12,
            "y": 8,
            "z": -390.66424208802914
          },
          "outgoing": {
            "x": -12,
            "y": 8,
            "z": -298.2546095307805
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 8,
      "endHeight": 8,
      "highwayRules": false,
      "attachments": {
        "start": {
          "road": "cloverleaf-south-in",
          "end": 1,
          "lanes": [
            0,
            1
          ],
          "ownLanes": [
            0,
            1
          ]
        }
      }
    },
    {
      "id": "r-mw7ir2gy-onb",
      "name": "单向两车道 · 后段",
      "knots": [
        {
          "p": {
            "x": -12,
            "y": 8,
            "z": -330.00488941546905
          },
          "incoming": {
            "x": -12,
            "y": 8,
            "z": -390.66424208802914
          },
          "outgoing": {
            "x": -12,
            "y": 8,
            "z": -298.2546095307805
          },
          "at": 0
        },
        {
          "p": {
            "x": -12,
            "y": 8,
            "z": -220.00317226539272
          },
          "incoming": {
            "x": -12,
            "y": 8,
            "z": -261.01815433930824
          },
          "outgoing": {
            "x": -12,
            "y": 8,
            "z": -154.06909890134642
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 8,
      "endHeight": 8,
      "highwayRules": false,
      "attachments": {}
    },
    {
      "id": "r-mw7ir2gy-ona",
      "name": "单向两车道 · 后段",
      "knots": [
        {
          "p": {
            "x": -12,
            "y": 8,
            "z": -220.00317226539272
          },
          "incoming": {
            "x": -12,
            "y": 8,
            "z": -339.37784979762057
          },
          "outgoing": {
            "x": -12,
            "y": 8,
            "z": -185.6523188943746
          },
          "at": 0
        },
        {
          "p": {
            "x": -12,
            "y": 8,
            "z": -110.00258261505346
          },
          "incoming": {
            "x": -12,
            "y": 8,
            "z": -148.6510587945722
          },
          "outgoing": {
            "x": -12,
            "y": 8,
            "z": -74.46799742181025
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 8,
      "endHeight": 8,
      "highwayRules": false,
      "attachments": {}
    },
    {
      "id": "r-mw7ir2gz-onc",
      "name": "单向两车道 · 后段 · 后段",
      "knots": [
        {
          "p": {
            "x": -12,
            "y": 8,
            "z": -110.00258261505346
          },
          "incoming": {
            "x": -12,
            "y": 8,
            "z": -148.6510587945722
          },
          "outgoing": {
            "x": -12,
            "y": 8,
            "z": -74.46799742181025
          },
          "at": 0
        },
        {
          "p": {
            "x": -12,
            "y": 8,
            "z": -0.0011157845592464355
          },
          "incoming": {
            "x": -12,
            "y": 8,
            "z": -37.54093429181205
          },
          "outgoing": {
            "x": -12,
            "y": 8,
            "z": 154.37964998617946
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 8,
      "endHeight": 8,
      "highwayRules": false,
      "attachments": {}
    },
    {
      "id": "r-mw7ir2gy-on9",
      "name": "单向两车道 · 后段",
      "knots": [
        {
          "p": {
            "x": -12,
            "y": 8,
            "z": -0.0011157845592464355
          },
          "incoming": {
            "x": -12,
            "y": 8,
            "z": -220.2591160133976
          },
          "outgoing": {
            "x": -12,
            "y": 8,
            "z": 36.32762846717864
          },
          "at": 0
        },
        {
          "p": {
            "x": -12,
            "y": 8,
            "z": 110.00002060085416
          },
          "incoming": {
            "x": -12,
            "y": 8,
            "z": 73.23022956385732
          },
          "outgoing": {
            "x": -12,
            "y": 8,
            "z": 147.04287354749655
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 8,
      "endHeight": 8,
      "highwayRules": false,
      "attachments": {}
    },
    {
      "id": "r-mw7ir2gz-one",
      "name": "单向两车道 · 后段 · 后段",
      "knots": [
        {
          "p": {
            "x": -12,
            "y": 8,
            "z": 110.00002060085416
          },
          "incoming": {
            "x": -12,
            "y": 8,
            "z": 73.23022956385732
          },
          "outgoing": {
            "x": -12,
            "y": 8,
            "z": 147.04287354749655
          },
          "at": 0
        },
        {
          "p": {
            "x": -12,
            "y": 8,
            "z": 220.00168181873613
          },
          "incoming": {
            "x": -12,
            "y": 8,
            "z": 183.95093654686679
          },
          "outgoing": {
            "x": -12,
            "y": 8,
            "z": 300.23602394099487
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 8,
      "endHeight": 8,
      "highwayRules": false,
      "attachments": {}
    },
    {
      "id": "r-mw7ir2gz-ond",
      "name": "单向两车道 · 后段 · 后段",
      "knots": [
        {
          "p": {
            "x": -12,
            "y": 8,
            "z": 220.00168181873613
          },
          "incoming": {
            "x": -12,
            "y": 8,
            "z": 148.16593984901417
          },
          "outgoing": {
            "x": -12,
            "y": 8,
            "z": 257.89487651863055
          },
          "at": 0
        },
        {
          "p": {
            "x": -12,
            "y": 8,
            "z": 330.0006400233516
          },
          "incoming": {
            "x": -12,
            "y": 8,
            "z": 294.8408841673943
          },
          "outgoing": {
            "x": -12,
            "y": 8,
            "z": 369.28749397751494
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 8,
      "endHeight": 8,
      "highwayRules": false,
      "attachments": {}
    },
    {
      "id": "r-mw7ir2gz-onf",
      "name": "单向两车道 · 后段 · 后段 · 后段",
      "knots": [
        {
          "p": {
            "x": -12,
            "y": 8,
            "z": 330.0006400233516
          },
          "incoming": {
            "x": -12,
            "y": 8,
            "z": 294.8408841673943
          },
          "outgoing": {
            "x": -12,
            "y": 8,
            "z": 369.28749397751494
          },
          "at": 0
        },
        {
          "p": {
            "x": -12,
            "y": 8,
            "z": 440
          },
          "incoming": {
            "x": -12,
            "y": 8,
            "z": 406.3441393581827
          },
          "outgoing": {
            "x": -12,
            "y": 8,
            "z": 440
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 8,
      "endHeight": 8,
      "highwayRules": false,
      "attachments": {
        "end": {
          "road": "cloverleaf-south-out",
          "end": 0,
          "lanes": [
            0,
            1
          ],
          "ownLanes": [
            0,
            1
          ]
        }
      }
    },
    {
      "id": "r-mw7ir9by-ykn",
      "name": "单向两车道",
      "knots": [
        {
          "p": {
            "x": -440,
            "y": 0,
            "z": 12
          },
          "incoming": {
            "x": -440,
            "y": 0,
            "z": 12
          },
          "outgoing": {
            "x": -431.2987062030651,
            "y": 0,
            "z": 12
          },
          "at": 0
        },
        {
          "p": {
            "x": -330.00488941546905,
            "y": 0,
            "z": 12
          },
          "incoming": {
            "x": -390.66424208802914,
            "y": 0,
            "z": 12
          },
          "outgoing": {
            "x": -298.2546095307805,
            "y": 0,
            "z": 12
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 0,
      "endHeight": 0,
      "highwayRules": false,
      "attachments": {
        "start": {
          "road": "cloverleaf-east-in",
          "end": 1,
          "lanes": [
            0,
            1
          ],
          "ownLanes": [
            0,
            1
          ]
        }
      }
    },
    {
      "id": "r-mw7ir9c4-ykq",
      "name": "单向两车道 · 后段",
      "knots": [
        {
          "p": {
            "x": -330.00488941546905,
            "y": 0,
            "z": 12
          },
          "incoming": {
            "x": -390.66424208802914,
            "y": 0,
            "z": 12
          },
          "outgoing": {
            "x": -298.2546095307805,
            "y": 0,
            "z": 12
          },
          "at": 0
        },
        {
          "p": {
            "x": -220.00317226539272,
            "y": 0,
            "z": 12
          },
          "incoming": {
            "x": -261.01815433930824,
            "y": 0,
            "z": 12
          },
          "outgoing": {
            "x": -154.06909890134642,
            "y": 0,
            "z": 12
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 0,
      "endHeight": 0,
      "highwayRules": false,
      "attachments": {}
    },
    {
      "id": "r-mw7ir9c4-ykp",
      "name": "单向两车道 · 后段",
      "knots": [
        {
          "p": {
            "x": -220.00317226539272,
            "y": 0,
            "z": 12
          },
          "incoming": {
            "x": -339.37784979762057,
            "y": 0,
            "z": 12
          },
          "outgoing": {
            "x": -185.6523188943746,
            "y": 0,
            "z": 12
          },
          "at": 0
        },
        {
          "p": {
            "x": -110.00258261505346,
            "y": 0,
            "z": 12
          },
          "incoming": {
            "x": -148.6510587945722,
            "y": 0,
            "z": 12
          },
          "outgoing": {
            "x": -74.46799742181025,
            "y": 0,
            "z": 12
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 0,
      "endHeight": 0,
      "highwayRules": false,
      "attachments": {}
    },
    {
      "id": "r-mw7ir9c4-ykr",
      "name": "单向两车道 · 后段 · 后段",
      "knots": [
        {
          "p": {
            "x": -110.00258261505346,
            "y": 0,
            "z": 12
          },
          "incoming": {
            "x": -148.6510587945722,
            "y": 0,
            "z": 12
          },
          "outgoing": {
            "x": -74.46799742181025,
            "y": 0,
            "z": 12
          },
          "at": 0
        },
        {
          "p": {
            "x": -0.0011157845592464355,
            "y": 0,
            "z": 12
          },
          "incoming": {
            "x": -37.54093429181205,
            "y": 0,
            "z": 12
          },
          "outgoing": {
            "x": 154.37964998617946,
            "y": 0,
            "z": 12
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 0,
      "endHeight": 0,
      "highwayRules": false,
      "attachments": {}
    },
    {
      "id": "r-mw7ir9c4-yko",
      "name": "单向两车道 · 后段",
      "knots": [
        {
          "p": {
            "x": -0.0011157845592464355,
            "y": 0,
            "z": 12
          },
          "incoming": {
            "x": -220.2591160133976,
            "y": 0,
            "z": 12
          },
          "outgoing": {
            "x": 36.32762846717864,
            "y": 0,
            "z": 12
          },
          "at": 0
        },
        {
          "p": {
            "x": 110.00002060085416,
            "y": 0,
            "z": 12
          },
          "incoming": {
            "x": 73.23022956385732,
            "y": 0,
            "z": 12
          },
          "outgoing": {
            "x": 147.04287354749655,
            "y": 0,
            "z": 12
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 0,
      "endHeight": 0,
      "highwayRules": false,
      "attachments": {}
    },
    {
      "id": "r-mw7ir9c5-ykt",
      "name": "单向两车道 · 后段 · 后段",
      "knots": [
        {
          "p": {
            "x": 110.00002060085416,
            "y": 0,
            "z": 12
          },
          "incoming": {
            "x": 73.23022956385732,
            "y": 0,
            "z": 12
          },
          "outgoing": {
            "x": 147.04287354749655,
            "y": 0,
            "z": 12
          },
          "at": 0
        },
        {
          "p": {
            "x": 220.00168181873613,
            "y": 0,
            "z": 12
          },
          "incoming": {
            "x": 183.95093654686679,
            "y": 0,
            "z": 12
          },
          "outgoing": {
            "x": 300.23602394099487,
            "y": 0,
            "z": 12
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 0,
      "endHeight": 0,
      "highwayRules": false,
      "attachments": {}
    },
    {
      "id": "r-mw7ir9c4-yks",
      "name": "单向两车道 · 后段 · 后段",
      "knots": [
        {
          "p": {
            "x": 220.00168181873613,
            "y": 0,
            "z": 12
          },
          "incoming": {
            "x": 148.16593984901417,
            "y": 0,
            "z": 12
          },
          "outgoing": {
            "x": 257.89487651863055,
            "y": 0,
            "z": 12
          },
          "at": 0
        },
        {
          "p": {
            "x": 330.0006400233516,
            "y": 0,
            "z": 12
          },
          "incoming": {
            "x": 294.8408841673943,
            "y": 0,
            "z": 12
          },
          "outgoing": {
            "x": 369.28749397751494,
            "y": 0,
            "z": 12
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 0,
      "endHeight": 0,
      "highwayRules": false,
      "attachments": {}
    },
    {
      "id": "r-mw7ir9c5-yku",
      "name": "单向两车道 · 后段 · 后段 · 后段",
      "knots": [
        {
          "p": {
            "x": 330.0006400233516,
            "y": 0,
            "z": 12
          },
          "incoming": {
            "x": 294.8408841673943,
            "y": 0,
            "z": 12
          },
          "outgoing": {
            "x": 369.28749397751494,
            "y": 0,
            "z": 12
          },
          "at": 0
        },
        {
          "p": {
            "x": 440,
            "y": 0,
            "z": 12
          },
          "incoming": {
            "x": 406.3441393581827,
            "y": 0,
            "z": 12
          },
          "outgoing": {
            "x": 440,
            "y": 0,
            "z": 12
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 0,
      "endHeight": 0,
      "highwayRules": false,
      "attachments": {
        "end": {
          "road": "cloverleaf-east-out",
          "end": 0,
          "lanes": [
            0,
            1
          ],
          "ownLanes": [
            0,
            1
          ]
        }
      }
    },
    {
      "id": "r-mw7ird4l-147x",
      "name": "单向两车道",
      "knots": [
        {
          "p": {
            "x": 440,
            "y": 0,
            "z": -12
          },
          "incoming": {
            "x": 440,
            "y": 0,
            "z": -12
          },
          "outgoing": {
            "x": 431.2987062030651,
            "y": 0,
            "z": -12
          },
          "at": 0
        },
        {
          "p": {
            "x": 330.00488941546905,
            "y": 0,
            "z": -12
          },
          "incoming": {
            "x": 390.66424208802914,
            "y": 0,
            "z": -12
          },
          "outgoing": {
            "x": 298.2546095307805,
            "y": 0,
            "z": -12
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 0,
      "endHeight": 0,
      "highwayRules": false,
      "attachments": {
        "start": {
          "road": "cloverleaf-west-in",
          "end": 1,
          "lanes": [
            0,
            1
          ],
          "ownLanes": [
            0,
            1
          ]
        }
      }
    },
    {
      "id": "r-mw7ird4q-1480",
      "name": "单向两车道 · 后段",
      "knots": [
        {
          "p": {
            "x": 330.00488941546905,
            "y": 0,
            "z": -12
          },
          "incoming": {
            "x": 390.66424208802914,
            "y": 0,
            "z": -12
          },
          "outgoing": {
            "x": 298.2546095307805,
            "y": 0,
            "z": -12
          },
          "at": 0
        },
        {
          "p": {
            "x": 220.00317226539272,
            "y": 0,
            "z": -12
          },
          "incoming": {
            "x": 261.01815433930824,
            "y": 0,
            "z": -12
          },
          "outgoing": {
            "x": 154.06909890134642,
            "y": 0,
            "z": -12
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 0,
      "endHeight": 0,
      "highwayRules": false,
      "attachments": {}
    },
    {
      "id": "r-mw7ird4q-147z",
      "name": "单向两车道 · 后段",
      "knots": [
        {
          "p": {
            "x": 220.00317226539272,
            "y": 0,
            "z": -12
          },
          "incoming": {
            "x": 339.37784979762057,
            "y": 0,
            "z": -12
          },
          "outgoing": {
            "x": 185.6523188943746,
            "y": 0,
            "z": -12
          },
          "at": 0
        },
        {
          "p": {
            "x": 110.00258261505346,
            "y": 0,
            "z": -12
          },
          "incoming": {
            "x": 148.6510587945722,
            "y": 0,
            "z": -12
          },
          "outgoing": {
            "x": 74.46799742181025,
            "y": 0,
            "z": -12
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 0,
      "endHeight": 0,
      "highwayRules": false,
      "attachments": {}
    },
    {
      "id": "r-mw7ird4q-1481",
      "name": "单向两车道 · 后段 · 后段",
      "knots": [
        {
          "p": {
            "x": 110.00258261505346,
            "y": 0,
            "z": -12
          },
          "incoming": {
            "x": 148.6510587945722,
            "y": 0,
            "z": -12
          },
          "outgoing": {
            "x": 74.46799742181025,
            "y": 0,
            "z": -12
          },
          "at": 0
        },
        {
          "p": {
            "x": 0.0011157845592464355,
            "y": 0,
            "z": -12
          },
          "incoming": {
            "x": 37.54093429181205,
            "y": 0,
            "z": -12
          },
          "outgoing": {
            "x": -154.37964998617946,
            "y": 0,
            "z": -12
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 0,
      "endHeight": 0,
      "highwayRules": false,
      "attachments": {}
    },
    {
      "id": "r-mw7ird4q-147y",
      "name": "单向两车道 · 后段",
      "knots": [
        {
          "p": {
            "x": 0.0011157845592464355,
            "y": 0,
            "z": -12
          },
          "incoming": {
            "x": 220.2591160133976,
            "y": 0,
            "z": -12
          },
          "outgoing": {
            "x": -36.32762846717864,
            "y": 0,
            "z": -12
          },
          "at": 0
        },
        {
          "p": {
            "x": -110.00002060085416,
            "y": 0,
            "z": -12
          },
          "incoming": {
            "x": -73.23022956385732,
            "y": 0,
            "z": -12
          },
          "outgoing": {
            "x": -147.04287354749655,
            "y": 0,
            "z": -12
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 0,
      "endHeight": 0,
      "highwayRules": false,
      "attachments": {}
    },
    {
      "id": "r-mw7ird4r-1483",
      "name": "单向两车道 · 后段 · 后段",
      "knots": [
        {
          "p": {
            "x": -110.00002060085416,
            "y": 0,
            "z": -12
          },
          "incoming": {
            "x": -73.23022956385732,
            "y": 0,
            "z": -12
          },
          "outgoing": {
            "x": -147.04287354749655,
            "y": 0,
            "z": -12
          },
          "at": 0
        },
        {
          "p": {
            "x": -220.00168181873613,
            "y": 0,
            "z": -12
          },
          "incoming": {
            "x": -183.95093654686679,
            "y": 0,
            "z": -12
          },
          "outgoing": {
            "x": -300.23602394099487,
            "y": 0,
            "z": -12
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 0,
      "endHeight": 0,
      "highwayRules": false,
      "attachments": {}
    },
    {
      "id": "r-mw7ird4r-1482",
      "name": "单向两车道 · 后段 · 后段",
      "knots": [
        {
          "p": {
            "x": -220.00168181873613,
            "y": 0,
            "z": -12
          },
          "incoming": {
            "x": -148.16593984901417,
            "y": 0,
            "z": -12
          },
          "outgoing": {
            "x": -257.89487651863055,
            "y": 0,
            "z": -12
          },
          "at": 0
        },
        {
          "p": {
            "x": -330.0006400233516,
            "y": 0,
            "z": -12
          },
          "incoming": {
            "x": -294.8408841673943,
            "y": 0,
            "z": -12
          },
          "outgoing": {
            "x": -369.28749397751494,
            "y": 0,
            "z": -12
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 0,
      "endHeight": 0,
      "highwayRules": false,
      "attachments": {}
    },
    {
      "id": "r-mw7ird4r-1484",
      "name": "单向两车道 · 后段 · 后段 · 后段",
      "knots": [
        {
          "p": {
            "x": -330.0006400233516,
            "y": 0,
            "z": -12
          },
          "incoming": {
            "x": -294.8408841673943,
            "y": 0,
            "z": -12
          },
          "outgoing": {
            "x": -369.28749397751494,
            "y": 0,
            "z": -12
          },
          "at": 0
        },
        {
          "p": {
            "x": -440,
            "y": 0,
            "z": -12
          },
          "incoming": {
            "x": -406.3441393581827,
            "y": 0,
            "z": -12
          },
          "outgoing": {
            "x": -440,
            "y": 0,
            "z": -12
          },
          "at": 1
        }
      ],
      "lanesStart": 2,
      "lanesEnd": 2,
      "twoWay": false,
      "width": 4,
      "speed": 60,
      "align": "center",
      "kind": "road",
      "transitionStart": 0,
      "transitionEnd": 1,
      "transitionMode": "direct",
      "height": 0,
      "endHeight": 0,
      "highwayRules": false,
      "attachments": {
        "end": {
          "road": "cloverleaf-west-out",
          "end": 0,
          "lanes": [
            0,
            1
          ],
          "ownLanes": [
            0,
            1
          ]
        }
      }
    }
  ],
  "connections": [],
  "ports": [
    {
      "road": "cloverleaf-east-in",
      "end": "start",
      "type": "source",
      "rate": 50
    },
    {
      "road": "cloverleaf-east-out",
      "end": "end",
      "type": "sink",
      "rate": 1
    },
    {
      "road": "cloverleaf-south-in",
      "end": "start",
      "type": "source",
      "rate": 50
    },
    {
      "road": "cloverleaf-south-out",
      "end": "end",
      "type": "sink",
      "rate": 1
    },
    {
      "road": "cloverleaf-west-in",
      "end": "start",
      "type": "source",
      "rate": 50
    },
    {
      "road": "cloverleaf-west-out",
      "end": "end",
      "type": "sink",
      "rate": 1
    },
    {
      "road": "cloverleaf-north-in",
      "end": "start",
      "type": "source",
      "rate": 50
    },
    {
      "road": "cloverleaf-north-out",
      "end": "end",
      "type": "sink",
      "rate": 1
    }
  ],
  "templates": [],
  "trafficMultiplier": 1,
  "trafficBaseRate": 50,
  "junctionLaneConnections": [
    {
      "from": {
        "road": "cloverleaf-south-collector-0",
        "lane": 1,
        "end": 1
      },
      "to": [
        {
          "road": "cloverleaf-south-right",
          "lane": 0,
          "end": 0
        }
      ]
    },
    {
      "from": {
        "road": "cloverleaf-east-collector-0",
        "lane": 1,
        "end": 1
      },
      "to": [
        {
          "road": "cloverleaf-east-right",
          "lane": 0,
          "end": 0
        }
      ]
    },
    {
      "from": {
        "road": "cloverleaf-west-collector-0",
        "lane": 1,
        "end": 1
      },
      "to": [
        {
          "road": "cloverleaf-west-right",
          "lane": 0,
          "end": 0
        }
      ]
    },
    {
      "from": {
        "road": "cloverleaf-north-collector-0",
        "lane": 1,
        "end": 1
      },
      "to": [
        {
          "road": "cloverleaf-north-right",
          "lane": 0,
          "end": 0
        }
      ]
    },
    {
      "from": {
        "road": "cloverleaf-north-collector-2",
        "lane": 1,
        "end": 1
      },
      "to": [
        {
          "road": "cloverleaf-north-left",
          "lane": 0,
          "end": 0
        }
      ]
    },
    {
      "from": {
        "road": "cloverleaf-south-collector-2",
        "lane": 1,
        "end": 1
      },
      "to": [
        {
          "road": "cloverleaf-south-left",
          "lane": 0,
          "end": 0
        }
      ]
    },
    {
      "from": {
        "road": "cloverleaf-east-collector-2",
        "lane": 1,
        "end": 1
      },
      "to": [
        {
          "road": "cloverleaf-east-left",
          "lane": 0,
          "end": 0
        }
      ]
    },
    {
      "from": {
        "road": "cloverleaf-west-collector-2",
        "lane": 1,
        "end": 1
      },
      "to": [
        {
          "road": "cloverleaf-west-left",
          "lane": 0,
          "end": 0
        }
      ]
    }
  ]
};

export default saved;
