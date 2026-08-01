import type { ReactNode } from "react";

const ARCS = [
  "M62 96Q112 66 160 52",
  "M160 52Q192 78 244 84",
  "M286 160Q294 212 254 246",
  "M254 246Q216 292 160 286",
  "M70 238Q34 208 40 170",
  "M40 170Q38 122 62 96",
  "M62 96Q108 128 148 140",
  "M148 140Q182 168 210 190",
  "M210 190Q236 214 254 246",
  "M148 140Q198 118 244 84",
  "M108 190Q126 166 148 140",
  "M70 238Q86 212 108 190",
  "M205 120Q178 130 148 140",
];

const DASHED_ARCS = [
  "M244 84Q292 116 286 160",
  "M160 286Q102 282 70 238",
  "M205 120Q248 138 286 160",
];

const NODES: readonly (readonly [number, number, number, string])[] = [
  [62, 96, 4, "0s"],
  [160, 52, 3, "-.5s"],
  [244, 84, 3.5, "-1s"],
  [286, 160, 3, "-1.5s"],
  [254, 246, 3.5, "-2s"],
  [160, 286, 3, "-2.5s"],
  [70, 238, 4, "-3s"],
  [40, 170, 3, "-3.5s"],
  [148, 140, 4.5, "-1.2s"],
  [210, 190, 3, "-2.2s"],
  [108, 190, 2.5, "-3.2s"],
  [205, 120, 2.5, "-.8s"],
];

const MERIDIAN_DELAYS = ["0s", "-3.6s", "-7.2s", "-10.8s", "-14.4s"];

export function Globe(): ReactNode {
  return (
    <figure aria-hidden className="viz">
      <svg focusable="false" viewBox="0 0 320 332" xmlns="http://www.w3.org/2000/svg">
        <g transform="rotate(-14 160 166)">
          <circle className="glb out" cx="160" cy="166" r="140" />
          <ellipse className="glb" cx="160" cy="166" rx="140" ry="36" />
          <ellipse className="glb" cx="160" cy="102" rx="124" ry="31" />
          <ellipse className="glb" cx="160" cy="230" rx="124" ry="31" />
          <ellipse className="glb" cx="160" cy="58" rx="89" ry="22" />
          <ellipse className="glb" cx="160" cy="274" rx="89" ry="22" />
          {MERIDIAN_DELAYS.map((delay) => (
            <ellipse
              className="mer"
              cx="160"
              cy="166"
              key={delay}
              rx="140"
              ry="140"
              style={{ animationDelay: delay }}
            />
          ))}
          <g className="network-spin">
            {ARCS.map((arc) => (
              <path className="arc" d={arc} key={arc} />
            ))}
            {DASHED_ARCS.map((arc) => (
              <path className="arc dsh" d={arc} key={arc} />
            ))}
            {NODES.map(([x, y, radius, delay]) => (
              <circle
                className="nd"
                cx={x}
                cy={y}
                key={`${x}-${y}`}
                r={radius}
                style={{ animationDelay: delay }}
              />
            ))}
            <circle className="pkt p1" r="2.2" />
            <circle className="pkt p2" r="2.2" />
            <circle className="pkt p3" r="2.2" />
          </g>
        </g>
      </svg>
    </figure>
  );
}
