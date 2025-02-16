# Send ^C to screen session window
screen -S bridge -X stuff $'\003'
echo Bridge stopped.
