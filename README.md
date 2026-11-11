# Raccoon Arcade

Raccoon Arcade è una raccolta di undici giochi per Mac con processore Apple Silicon (M1, M2, M3, M4).

## Giochi

Al tavolo:

| Gioco | Note |
|---|---|
| Scopa | Contro il computer, con carte piacentine vere. Vince chi arriva a 11 punti. |
| Briscola | Contro il computer. Vince chi fa almeno 61 punti. |
| Solitario | Il solitario classico con il mazzo da 40 carte. |
| Dama | Dama italiana con il Damone: solo un Damone può mangiare un Damone. Tre livelli. |
| Sudoku | Tre livelli. Ogni schema ha una sola soluzione. |
| Mahjong | Disposizione classica "a tartaruga" con le tessere tradizionali. Musica calma. |

Sala giochi:

| Gioco | Note |
|---|---|
| Tetris | I sette pezzi classici con i colori standard. |
| Bolle | Tre bolle dello stesso colore scoppiano. |
| Raccoon Defender | Nello stile di Space Invaders del 1978. |
| Raccoon-man | Nello stile di Pac-Man: labirinto, puntini e fantasmi. |
| Snake | Il serpente dei vecchi telefonini. |

Le fonti delle immagini e dei caratteri sono in [CREDITS.md](CREDITS.md).

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

Esegui i test delle regole (45 test, con bot che giocano partite intere):

```bash
npm test
```

Salva una immagine di ogni gioco a partita in corso (serve Playwright):

```bash
npm run screenshots
```

Crea il file `.dmg` per Mac M1 (va eseguito su un Mac):

```bash
npm run build:mac
```

Il file finale finisce nella cartella `dist/`.

## Struttura

- `main.js`: finestra Electron.
- `src/index.html`, `src/css/style.css`: pagina e stile.
- `src/assets/`: carte piacentine e caratteri.
- `src/js/core/`: utilità, audio, base per i giochi a canvas.
- `src/js/games/`: un file per gioco, con regole e interfaccia.
- `tests/`: test automatici delle regole. `tests/e2e/`: prove nel browser.
- `.github/workflows/build-mac.yml`: crea il `.dmg` su un runner macOS M1.

## Controlli generali

- Menu: clicca un gioco. Il pulsante **Menu** torna al menu. Il tasto **Esc** fa lo stesso.
- Suono: il pulsante **Suono** accende o spegne i suoni.
- Nei giochi della sala giochi si usano le frecce e la barra spaziatrice. Il tasto Invio avvia la partita.
