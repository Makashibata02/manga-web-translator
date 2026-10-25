from engine.native import main, reply
if __name__ == "__main__":
    try: main()
    except Exception as error: reply({"error": str(error)})
