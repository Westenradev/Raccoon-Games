# Raccoon Arcade 🦝

Raccoon Arcade è una raccolta di giochi a tema procione per Mac con processore Apple Silicon (M1, M2, M3, M4).

## Giochi

| Gioco | Note |
|---|---|
| Scopa | Contro il Gatto. Carte in stile Piacentino con animali. Prima a 11 punti. |
| Briscola | Contro il Gatto. Una mano per partita. |
| Solitario | Klondike con il mazzo da 40 carte. Doppio tocco per la pila finale. |
| Sudoku | Tre livelli: Facile, Medio, Difficile. Ogni puzzle ha una sola soluzione. |
| Mahjong | Trova le coppie di tessere uguali. Suoni rilassanti. |
| Dama | Con Damone. Il Damone si mangia solo con un altro Damone. Tre livelli di CPU. |
| Bolle Procioni | Spara le bolle. Tre uguali scoppiano. |
| Tetris | Blocchi con i simboli degli animali. |
| Raccoon Defender | Space Invaders. Il procione difende dai gatti, dai topi e dai chihuahua. |
| Raccoon-man | Pac-Man. Mangia le ghiande, scappa dai gatti. |
| Snake | Il procione mangia i pesci. |

## Installazione su Mac M1 (per l'utente finale)

1. Apri la pagina **Actions** del repository su GitHub.
2. Apri l'ultima esecuzione riuscita di **Build Raccoon Arcade (Mac M1)**.
3. Scarica il file **RaccoonArcade-arm64** e scompattalo.
4. Apri il file `.dmg` e trascina **Raccoon Arcade** nella cartella **Applicazioni**.
5. La prima volta, fai clic con il tasto destro su **Raccoon Arcade** e scegli **Apri**. Poi conferma con **Apri**.

Il Mac può mostrare un avviso perché l'app non è firmata da Apple. Il passaggio 5 basta una volta sola.

## Comandi (per chi sviluppa)

Requisiti: Node.js 20 o successivo.

```bash
npm install
```

Avvia l'app in una finestra:

```bash
npm start
```

Esegui i test della logica di gioco:

```bash
npm test
```

Crea il file `.dmg` per Mac M1 (va eseguito su un Mac):

```bash
npm run build:mac
```

Il file finale finisce nella cartella `dist/`.

## Struttura

- `main.js`: finestra Electron.
- `src/index.html`, `src/css/style.css`: pagina e stile.
- `src/js/core/`: utilità, audio, base per i giochi a canvas.
- `src/js/games/`: un file per gioco, con regole e interfaccia.
- `tests/`: test automatici delle regole e dei generatori.
- `.github/workflows/build-mac.yml`: crea il `.dmg` su un runner macOS M1.

## Controlli generali

- Menu: clicca un gioco. Il tasto **⬅ Menu** torna al menu. Il tasto **Esc** fa lo stesso.
- Audio: il pulsante 🔊 accende o spegne i suoni.
- Frecce o tasti W A S D muovono i personaggi nei giochi a canvas. Spazio spara o fa cadere il blocco.
