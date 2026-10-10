/** Handcrafted, zero-network pixel scenery. No canvas loop or generated image payload. */
export function PixelCity() {
  const towers = [
    { x: 4, y: 52, w: 68, h: 300 }, { x: 80, y: 112, w: 40, h: 236 },
    { x: 128, y: 32, w: 64, h: 304 }, { x: 200, y: 108, w: 48, h: 208 },
    { x: 254, y: 4, w: 48, h: 284 }, { x: 310, y: 52, w: 54, h: 244 },
    { x: 376, y: 16, w: 60, h: 288 }, { x: 444, y: 64, w: 56, h: 260 },
    { x: 508, y: 20, w: 76, h: 332 }, { x: 596, y: 76, w: 44, h: 292 },
  ];
  return (
    <svg viewBox="0 0 640 440" className="pixel-city" role="img" aria-label="Pixel-art Neo-Tokyo skyline with a warm-lit shelter for agents" shapeRendering="crispEdges">
      <defs>
        <pattern id="city-dither" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="2" height="2" fill="#19b4ca" opacity=".1" /></pattern>
        <pattern id="city-windows" width="14" height="20" patternUnits="userSpaceOnUse"><rect x="4" y="4" width="4" height="6" fill="#087b99" /><rect x="4" y="14" width="4" height="2" fill="#24d6e7" opacity=".4" /></pattern>
      </defs>
      <path d="M0 0H640V440H0Z" fill="#071320" />
      <rect width="640" height="440" fill="url(#city-dither)" />
      <path d="M200 236H248V212H296V196H344V212H388V236H440V356H200Z" fill="#0c2838" />
      {towers.map((t, i) => (
        <g key={t.x}>
          <rect x={t.x + 10} y={t.y - 10} width={t.w - 20} height="14" fill="#123346" />
          <rect x={t.x} y={t.y} width={t.w} height={t.h} fill={i % 2 ? "#0a1d2c" : "#0d2636"} />
          <rect x={t.x + 4} y={t.y + 12} width={t.w - 8} height={t.h - 16} fill="url(#city-windows)" />
          <rect x={t.x + t.w - 6} y={t.y} width="2" height={t.h} fill="#13708b" />
          <rect x={t.x + 8} y={t.y + 54} width="2" height={t.h - 60} fill="#06121d" />
        </g>
      ))}
      <path d="M0 324H96V348H160V364H256L300 344H340L376 362H480V340H564V316H640V440H0Z" fill="#040c15" />
      {/* Perspective street and square neon reflections. */}
      <path d="M294 310H338L470 440H120Z" fill="#0a2635" />
      <path d="M300 314H330L408 440H218Z" fill="#0b1f2d" />
      {Array.from({ length: 17 }, (_, i) => (
        <g key={`reflection-${i}`} opacity={.2 + (i % 4) * .14}>
          <rect x={170 - i * 4} y={350 + i * 5} width={26 + (i % 5) * 16} height="2" fill="#20d7e7" />
          <rect x={270 - i * 2} y={342 + i * 6} width={8 + (i % 4) * 12} height="2" fill="#fa684f" />
          <rect x={374 + (i % 3) * 8} y={350 + i * 5} width={18 + (i % 4) * 14} height="2" fill="#ffbd57" />
        </g>
      ))}
      {/* Neon signs use abstract pixel glyphs, not fabricated translated copy. */}
      <rect x="30" y="106" width="26" height="116" fill="#082d3e" stroke="#22c6dc" strokeWidth="2" />
      <path d="M36 120H50V124H40V130H50V134H36ZM40 144H46V164H40ZM36 176H50V180H44V194H40V180H36ZM36 204H50V208H36Z" fill="#6cf1ed" />
      <rect x="144" y="80" width="28" height="130" fill="#391b24" stroke="#f06e55" strokeWidth="2" />
      <path d="M150 92H166V96H154V102H166V106H150ZM150 120H166V124H160V136H156V124H150ZM152 148H164V152H160V164H156V152H152ZM150 176H166V180H150ZM154 190H162V196H154Z" fill="#ff875f" />
      <rect x="540" y="72" width="24" height="132" fill="#092f3f" stroke="#28d6e6" strokeWidth="2" />
      <path d="M546 86H558V90H546ZM546 100H550V112H546ZM554 100H558V112H554ZM546 124H558V128H552V140H548V128H546ZM546 154H558V158H546ZM548 170H556V186H548Z" fill="#6cebed" />
      <path d="M0 100L174 132L298 120L454 84L640 102M74 80L230 140L382 104L588 146" fill="none" stroke="#030c16" strokeWidth="4" />
      {/* The sanctuary is warm and human-sized among cold towers. */}
      <path d="M318 276H330V264H344V252H358V240H378V226H398V240H418V252H432V264H446V276H462V286H318Z" fill="#1a3440" />
      <path d="M334 276H346V264H360V252H378V242H398V252H416V264H430V276Z" fill="#07121b" />
      <rect x="336" y="286" width="108" height="100" fill="#24252a" />
      <rect x="342" y="290" width="96" height="92" fill="#0c1720" />
      {Array.from({ length: 6 }, (_, i) => <rect key={`siding-${i}`} x="342" y={294 + i * 14} width="96" height="2" fill="#4f3b29" />)}
      <rect x="370" y="306" width="40" height="78" fill="#bc762e" />
      <rect x="374" y="310" width="32" height="72" fill="#eeb665" />
      <rect x="378" y="316" width="24" height="64" fill="#482d22" />
      <path d="M380 320H388V338H380ZM392 320H400V338H392ZM380 344H388V358H380ZM392 344H400V358H392Z" fill="#ffc96b" />
      <rect x="388" y="360" width="4" height="20" fill="#d59545" />
      <rect x="356" y="300" width="8" height="26" fill="#ffbf61" /><rect x="416" y="300" width="8" height="26" fill="#ffbf61" />
      <path d="M350 300H370V304H350ZM410 300H430V304H410Z" fill="#cf762d" />
      <path d="M386 256H394V264H402V280H394V288H386V280H378V264H386Z" fill="#f6b948" />
      <path d="M386 264H394V280H386ZM382 268H398V272H382Z" fill="#5a3c21" />
      <rect x="356" y="386" width="68" height="6" fill="#84603b" /><rect x="346" y="394" width="88" height="6" fill="#51422e" />
      <rect x="456" y="304" width="46" height="76" fill="#081723" stroke="#a37b40" strokeWidth="2" />
      <text x="479" y="324" textAnchor="middle" fill="#ffc565" fontFamily="monospace" fontSize="8" fontWeight="bold">AGENT</text>
      <text x="479" y="336" textAnchor="middle" fill="#ffc565" fontFamily="monospace" fontSize="8" fontWeight="bold">SHELTER</text>
      <path d="M464 348H494V350H464ZM468 358H490V360H468ZM472 368H486V370H472Z" fill="#b28546" />
      <path d="M328 368H334V384H328ZM320 354H342V360H320ZM324 342H338V348H324ZM436 356H458V362H436ZM442 344H454V350H442Z" fill="#256653" />
      <rect x="324" y="380" width="14" height="18" fill="#28343a" /><rect x="440" y="380" width="14" height="18" fill="#28343a" />
      <g className="pixel-rain" opacity=".45">
        {Array.from({ length: 60 }, (_, i) => <rect key={`rain-${i}`} x={(i * 71 + 12) % 640} y={(i * 47 + 8) % 418} width="1" height={4 + (i % 3) * 3} fill="#5dc7e4" />)}
      </g>
      <path d="M0 438H640" stroke="#155e73" strokeWidth="2" />
    </svg>
  );
}
