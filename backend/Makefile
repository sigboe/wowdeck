.PHONY: all clean

all:
	mkdir -p ./out
	bun build --compile --target=bun-linux-x64 src/main.ts --outfile ./out/wowdeck

clean:
	rm -rf ./out
