# Picross 3D XR

Mini-game estilo Picross 3D em WebXR, renderizado com o `WebGPURenderer` do three.js (materiais TSL).
Um nível procedural por seed: a forma escondida é gerada, e o solver garante que ela tenha
**solução única só com lógica de linhas** antes de esconder parte das dicas.

## Rodar localmente

Não precisa de build, Node nem internet: o three.js 0.180.0 e os modelos de mãos/controles
ficam em `vendor/` (baixados com `py scripts/vendor_deps.py`) e são carregados via import map.

```bash
py serve.py
```

Depois abra http://localhost:8080. Parâmetros de URL: `?seed=123`, `?size=4..7`, `?backend=webgpu|webgl`.

## Testar no Quest (USB)

WebXR exige contexto seguro, e `localhost` conta como seguro. Encaminhe a porta e abra no Quest Browser:

```bash
adb reverse tcp:8080 tcp:8080
```

Abra `http://localhost:8080` no Quest Browser e toque em **Entrar no VR**.

## Controles

O jogo é totalmente jogável só com as mãos (hand tracking); controles continuam suportados.

| Ação | Mãos | Controles XR | Desktop |
|---|---|---|---|
| Quebrar (modo atual) | pinça da mão direita | gatilho | clique esquerdo |
| Pintar (proteger cubo) | pinça da mão esquerda | A / X | clique direito |
| Girar o puzzle | pinça na bolha (raio ou encostando a mão) e arrastar | gatilho na bolha, ou grip | arrastar |
| Fatiar camadas | palma aberta voltada ao puzzle, empurrando | analógico ←/→, clique troca eixo | Q / E, C eixo, F lado |
| Trocar modo | botão de modo no painel | B / Y | Espaço |

**Corte com a palma:** mão aberta e reta, palma voltada para uma face do puzzle. As camadas entre você e a
palma somem conforme você empurra. Ao tirar a mão, o corte fica; recuar a palma para fora desfaz o corte.

**Bolha:** o ponto agarrado acompanha a mão (arcball) e o giro continua com inércia ao soltar.

Com as mãos, a pinça usa o alvo de ~90 ms antes do gesto, para compensar o desvio do raio ao fechar os dedos.

## Modo mesa (AR)

No Quest, **Modo mesa (AR)** abre uma sessão com passthrough. Aponte para uma mesa até aparecer o anel azul
(hit-test em superfícies horizontais) e faça a pinça: o puzzle surge como holograma sobre um projetor.
O botão **MOVER** no painel reposiciona. Requer o ambiente/espaço configurado no Quest para detectar a mesa;
sem hit-test, ele posiciona 45 cm abaixo dos olhos, à sua frente.

Segurar e arrastar aplica a ação ao longo de uma única linha, como no original.

## Regras

- O número na face é quantos cubos da forma existem na linha que atravessa aquela face.
- ◯ = esses cubos estão divididos em 2 grupos; ▢ = em 3 ou mais grupos.
- Quebrar um cubo da forma conta como erro (ele fica marcado). Vitória: quando restam só os cubos da forma.

## Nota sobre WebGPU + XR

O three.js ainda não consegue apresentar sessões imersivas pelo backend WebGPU. Quando o navegador
suporta `immersive-vr`, o jogo inicia o mesmo `WebGPURenderer`/TSL com o backend WebGL2. No desktop
sem XR, ele usa o WebGPU nativo. O código de cena e de shader é o mesmo nos dois casos.

## Estrutura

- `src/puzzle.js`: gerador (metaballs simétricas + entalhes), solver de linhas e ocultação de dicas
- `src/board.js`: InstancedMesh único com atlas de dicas em TSL e raycast DDA na grade
- `src/panel.js`: painel de UI no mundo (canvas para textura)
- `src/main.js`: renderer, entrada (mouse/controles/mãos), sessão XR e loop
- `src/environment.js`, `src/particles.js`, `src/audio.js`: ambiente, estilhaços/confete e SFX sintetizados
