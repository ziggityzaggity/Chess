import parse
s = ["WorldChamp201" + str(t) for t in (4, 6, 8)]
for str in s:
    with open(str + ".pgn", "r") as data:
        text = data.read()
    e = ""
    par = parse.findall("]\n\n{}\n\n", text)
    for p in par:
        print(p[0])
    print("--------------------------------------")
