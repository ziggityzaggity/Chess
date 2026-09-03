# Welcome to PyChess! To use the app, visit [pychess.app](https://www.pychess.app)
<img width="3840" height="1787" alt="image" src="https://github.com/user-attachments/assets/8b81f9f1-f0a6-491b-abd6-54d5255353af" />

## Background 
This is an updated version of my final project for CS50 in 2022. The original version was written 100% in Python using the PyGame module. Now, this project is a full-stack web app that allows users to play chess on their web browser either locally, against another user on the app, or against one of our bots! 

## Walkthrough
The core chess logic of the games lives in the ```/core/``` directory. This module was designed to be lightweight and thread-safe so that it can allow us to both train our models and implement the chess logic in the browser efficiently.

```/bindings/web/chess_web.cpp``` exposes a TypeScript interface ```/web/src/lib/engine.ts``` for the above module which is compiled to ```/web/public/engine/chessengine.wasm```, which is linked to our React web UI in ```/web/src/app/game/page.tsx```.

User authentication is handled by Supabase using the Resend SMTP to send 6-digit verification codes. User data is stored in a PostgreSQL database on Supabase. Hosting is handled by Vercel and the build is kept up-to-date by the github-actions bot.

Many many more features to come!

## Old Version Video Demo:  [Chess in Python](https://www.youtube.com/watch?v=UXmZuAgts7U)
