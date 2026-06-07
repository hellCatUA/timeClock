# Simple Time Clock Tool For Techs

> ## Functionality
>
> - #### Time Clock
>   - Clock In/Out Now
>   - Clock In/Out Early/Later rounded up to closest 00/05
>   - Clock In/Out at specific time
>   - Total Time Tracking
>   - Real Time Earnings Tracking based on selected pay rate
>  
>  - #### Reporting Tool
>    - Fields for:
>      - Company/Buyer
>      - Client
>      - Address
>      - Ticket IDs
>      - POC Names
>      - Materials to bill
>      - SOW Completed
>      - Job Status
>    - Submit related pictures:
>      - Before
>      - Additional Info/Issues
>      - After
>      - Serial #
>
>  - #### Statistics
>  - Total Jobs Completed
>  - Total Earnings By Period
>  - COMPLETED/FAIL Overview
> 

## Build

```
git clone https://github.com/hellCatUA/timeClock.git
```
```
mkdir -p /your/path/timeClock/data
```

> Change server_name timeclock.local; to your hostname
> ```
> cd /your/path/timeClock
> nano nginx.conf
> ```

```
docker compose up -d --build
```
