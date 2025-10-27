#!/bin/bash
for var in $(cat .env); do
  export $var
done
