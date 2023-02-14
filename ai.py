from copy import deepcopy
from objects import *
from random import *

# 
VALUES = {'p': 1, 'K': 3, 'B': 3, 'Q': 9, 'R': 5}
BOARDRATE = {'w': 1, 'b': -1}

class Player:
    # use this to determine who is active and what the active player can do
    pass

class Human(Player):
    pass
    # standard human player, capable of undo, redo, moving, etc


class AI(Player):
    # AI player, for determining and making moves based on certain algorithms, unable to undo, redo, etc
    def __init__(self, board, colour):
        self.colour = colour
        self.board = board
    

class Random(AI):
    def getMove(self, moves)-> Move: 
        return moves[randint(0, len(moves)-1)]
    
