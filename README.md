# Chess in Python by ziggityzaggity
## Table of contents:
[Video Demo](#video-demo)

[Description](#description)

[Screenshots](#screenshots)

[Installation](#installation)

[Appreciations](#appreciations)
## Video Demo:  [Chess in Python](https://www.youtube.com/watch?v=UXmZuAgts7U)
## Description: 
This is a simple chess program in Python. The GUI was made using Pygame, the config.txt file is read by the parse module, it will not work properly without the required piece textures in the textures directory. The engine is completely accurate in that every piece moves exactly per the rules of chess, including en passent and castling, no player can end their turn with their king in check. You can press backspace and tab to undo and redo moves respectively, however cannot redo further after making a move. You can edit the optional config.txt file to change the colour of the board.

The program uses classes for the game, pieces, and moves. The game is initialised once in main and not referenced outside of it meaning that a person could alter the code relatively easily to make alternate boards to the one being used, this is possible because the game points to all the pieces and the pieces point to the board.

The checkForCheck function accepts an optional move class as a variable to change the board using it to determine if it would cause the player to be in check. The findMoves function calls the checkForCheck function to return only moves that would be legal. The findMoves function takes a required "test" argument to determine which layer of recursion, False if the first, meaning that all moves have to be checked via checkForCheck, and True if called by checkForCheck to make sure that it does not get called by findMoves again.

The move class, along with the getAllMoves function and parse module, generates enough information to export and import .pgn files (which are used to store chess games), however unfortunately I have yet to write code allowing them to do so.

## Screenshots:
[Castle Before](./screenshots/castle-before.png)

[Castle After](./screenshots/castle-after.png)

[Double Jump](./screenshots/doublejump.png)

[En passent](./screenshots/enpassent.png)

[Pawn Capture](./screenshots/pawncapture.png)

[Pawn Upgrade](./screenshots/pawnupgrade.png)

[Queen Moves](./screenshots/queenmoves.png)

## Installation:
Just download the files and run chess.py, will require pygame and parse modules to be installed (via pip. In the chess directory type "py -m pip install -r requirements.txt". Only the textures are necessary, screenshots and config file are not.

## Appreciations:
Per the CS50 course website and its gallery of projects for the previous year, I was able to see the creations of other students with the same idea to create a chess program.

The piece textures and where I learned to use pygame are courtesy of [Eddie Sharick and his tutorial](https://www.youtube.com/watch?v=EnYui0e73Rs).

Thanks to [W3Schools](https://www.w3schools.com/) and [GeeksforGeeks](https://www.geeksforgeeks.org/) for all the information and resources that they provide.

As well, thanks to the makers of [Python](https://www.python.org) and its documentation, and to the makers of all the superb and useful modules for python, particularly the [pygame module](https://www.pygame.org).

Much appreciation for Harvard's [CS50 course](https://cs50.harvard.edu) and its amazing teachers and support staff.
