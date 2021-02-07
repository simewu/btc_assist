read -p "Are you sure you would like to remove the entire redis database? (y/n)" -n 1 -r
echo    # (optional) move to a new line
if [[ $REPLY =~ ^[Yy]$ ]]
then
    redis-cli FLUSHALL ASYNC
    echo "Database was deleted."
fi