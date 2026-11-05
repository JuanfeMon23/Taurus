import uvicorn

if __name__ == "__main__":
    # Solo loopback: la app es personal y no tiene login.
    uvicorn.run("app.main:app", host="127.0.0.1", port=8400)
