# Raccoon Arcade

Raccoon Arcade è una raccolta di undici giochi per Mac con processore Apple Silicon (M1, M2, M3, M4) e per Linux a 64 bit.

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
| Raccoon Defender | Nello stile di Space Invaders: invasori a colori, ripari e un disco volante che vale punti extra. |
| Raccoon-man | Nello stile di Pac-Man: labirinto, puntini e fantasmi. |
| Snake | Un serpente a strisce in un prato: mangia la frutta e cresce. |

Le fonti delle immagini e dei caratteri sono in [CREDITS.md](CREDITS.md).

## Installazione

I file pronti si scaricano dalla pagina **Actions** del repository su GitHub. Apri l'ultima esecuzione riuscita di **Build Raccoon Arcade**. In fondo alla pagina ci sono due pacchetti: **RaccoonArcade-mac-arm64** e **RaccoonArcade-linux-x64**.

### Mac con Apple Silicon (M1, M2, M3, M4)

Il file giusto è il `.dmg` creato da GitHub (pacchetto **RaccoonArcade-mac-arm64**). Viene costruito e firmato su un Mac vero.

1. Apri il file `.dmg`.
2. Trascina **Raccoon Arcade** nella cartella **Applicazioni**.
3. Apri **Raccoon Arcade**. La prima volta il Mac può dire che non può controllare l'app. Questo succede perché l'app non ha la firma a pagamento di Apple. Per aprirla senza usare il Terminale:
   - **macOS 14 e precedenti:** fai clic con il tasto destro su **Raccoon Arcade**, scegli **Apri** e conferma con **Apri**.
   - **macOS 15 e successivi:** apri **Impostazioni di Sistema**, poi **Privacy e sicurezza**. In basso premi **Apri comunque** vicino a "Raccoon Arcade". Scrivi la password del Mac e conferma.
4. Dalla seconda volta l'app si apre con un doppio clic.

Il passaggio 3 si fa una volta sola. Se il Mac è di una persona che non usa bene il computer, conviene farlo al suo posto la prima volta.

Se il file arriva da una chiavetta USB o da iCloud Drive e non da internet, il Mac non fa nemmeno questa domanda.

Se il Mac dice che l'app è "danneggiata", il file non è stato firmato (per esempio un `.zip` creato su Linux). Apri il Terminale e scrivi questi due comandi:

```bash
xattr -cr "/Applications/Raccoon Arcade.app"
```

```bash
codesign --force --deep --sign - "/Applications/Raccoon Arcade.app"
```

### Linux (64 bit)

Scarica **RaccoonArcade-linux-x64**. Contiene due file. Ne basta uno.

**AppImage** (non serve installare niente):

```bash
chmod +x RaccoonArcade-1.0.0-linux-x86_64.AppImage
```

```bash
./RaccoonArcade-1.0.0-linux-x86_64.AppImage
```

Se non si apre, per esempio su Ubuntu 24.04, prova così:

```bash
./RaccoonArcade-1.0.0-linux-x86_64.AppImage --no-sandbox
```

**Archivio `.tar.gz`**:

```bash
tar xzf RaccoonArcade-1.0.0-linux-x64.tar.gz
```

```bash
./raccoon-arcade-1.0.0/raccoon-arcade
```

Aggiungi `--no-sandbox` alla fine se serve, come sopra.

## Comandi (per chi sviluppa)

Requisiti: Node.js 20 o successivo.

```bash
npm install
```

Avvia l'app in una finestra:

```bash
npm start
```

Esegui i test delle regole (50 test, con bot che giocano partite intere):

```bash
npm test
```

Esegui le prove nel browser: giocano tutti i giochi con clic e tasti veri, e controllano anche le partite salvate. Durano circa 10 minuti e richiedono Playwright:

```bash
npm run test:e2e
```

Salva una immagine di ogni gioco a partita in corso (serve Playwright):

```bash
npm run screenshots
```

Crea i file per Mac M1: `.dmg` e `.zip` (va eseguito su un Mac):

```bash
npm run build:mac
```

Crea solo il `.zip` per Mac M1 (funziona anche su Linux):

```bash
npm run build:mac-zip
```

Crea i file per Linux: `.AppImage` e `.tar.gz`:

```bash
npm run build:linux
```

I file finali finiscono nella cartella `dist/`.

## Struttura

- `main.js`: finestra Electron.
- `src/index.html`, `src/css/style.css`: pagina e stile.
- `src/assets/`: carte piacentine, caratteri e icona.
- `build/`: icona (`icon.svg` è l'originale) e firma automatica per Mac.
- `src/js/core/`: utilità, audio, partite salvate, base per i giochi a canvas.
- `src/js/games/`: un file per gioco, con regole e interfaccia.
- `tests/`: test automatici delle regole. `tests/e2e/`: prove nel browser.
- `.github/workflows/build.yml`: crea i file per Mac (runner macOS M1) e per Linux.

## Controlli generali

- Menu: clicca un gioco. Il pulsante **Menu** torna al menu. Il tasto **Esc** fa lo stesso.
- Suono: il pulsante **Suono** accende o spegne i suoni.
- Nei giochi della sala giochi si usano le frecce e la barra spaziatrice. Il tasto Invio avvia la partita.
- Il tasto **P** mette in pausa. Il gioco va in pausa da solo quando si passa a un'altra finestra.
- I record si salvano appena vengono battuti.

## Partite salvate

- Ogni gioco salva da solo la partita in corso quando si torna al menu o si chiude l'app.
- Nel menu, il gioco con una partita lasciata a metà mostra la scritta **Partita in sospeso**.
- Alla riapertura il gioco chiede: **Riprendi la partita** oppure **Inizia una nuova partita**.
- Una partita finita non viene conservata.
